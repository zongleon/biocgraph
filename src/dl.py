#!/usr/bin/env python3
import argparse
import time
import requests
import pandas as pd
from bs4 import BeautifulSoup
from io import StringIO

def fetch_url(url, retries=3, backoff_factor=1.0):
    """Fetch a URL with retries. Returns None on unrecoverable errors like 404."""
    for attempt in range(retries):
        try:
            response = requests.get(url)
            if response.status_code == 404:
                print(f"URL not found (404): {url}")
                return None
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", "1"))
                print(f"Rate limited on {url}. Sleeping for {retry_after} seconds...")
                time.sleep(retry_after)
                continue
            if not response.ok:
                print(f"Error fetching {url}: {response.status_code}")
                return None
            return response.text
        except Exception as e:
            wait = backoff_factor * (2 ** attempt)
            print(f"Exception fetching {url}: {e}. Retrying in {wait} seconds.")
            time.sleep(wait)
    return None

def parse_html(html):
    """Extract key fields from the package HTML page."""
    soup = BeautifulSoup(html, "html.parser")
    data = {}

    # Extract DOI from a <p> element starting with "DOI:"
    doi = ""
    for p in soup.find_all("p"):
        if p.get_text(strip=True).startswith("DOI:"):
            a = p.find("a")
            if a:
                doi = a.get_text(strip=True)
            break
    data["DOI"] = doi

    # Use the og:description meta tag for the package description.
    meta_desc = soup.find("meta", {"property": "og:description"})
    data["Description"] = meta_desc["content"] if meta_desc else ""

    # Parse table rows to get Version, In Bioconductor since, Imports, and URL.
    version = ""
    bioc_since = ""
    imports = ""
    pkg_url = ""
    suggests = ""
    biocViews = ""
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) >= 2:
            key = tds[0].get_text(strip=True)
            value = tds[1].get_text(" ", strip=True)
            if key == "Version":
                version = value
            elif key == "In Bioconductor since":
                bioc_since = value
            elif key == "Imports":
                imports = value
            elif key == "URL":
                pkg_url = value
            elif key == "Suggests":
                suggests = value
            elif key == "biocViews":
                biocViews = value
    data["Version"] = version
    data["In Bioconductor since"] = bioc_since
    data["Imports"] = imports
    data["URL"] = pkg_url
    data["Suggests"] = suggests
    data["biocViews"] = biocViews

    # Extract Authors and Maintainer from the package-info div.
    authors = ""
    maintainer = ""
    pkg_info = soup.find("div", class_="package-info")
    if pkg_info:
        for p in pkg_info.find_all("p"):
            strong = p.find("strong")
            if strong:
                label = strong.get_text(strip=True).rstrip(":")
                if label == "Author":
                    authors = p.get_text(strip=True).replace("Author:", "").strip()
                elif label == "Maintainer":
                    maintainer = p.get_text(strip=True).replace("Maintainer:", "").strip()
    data["Authors"] = authors
    data["Maintainer"] = maintainer

    return data

def parse_stats(stats_text):
    """Use pandas to read the tab-delimited stats file and extract 2024 stats."""
    df = pd.read_csv(StringIO(stats_text), delimiter="\t")
    df_2024 = df[df["Year"] == 2024]
    # Prefer the aggregated row (Month == "all"); if not, sum the monthly values.
    if any(df_2024["Month"].str.lower() == "all"):
        row = df_2024[df_2024["Month"].str.lower() == "all"].iloc[0]
        unique_ips = row["Nb_of_distinct_IPs"]
        downloads = row["Nb_of_downloads"]
    else:
        unique_ips = df_2024["Nb_of_distinct_IPs"].sum()
        downloads = df_2024["Nb_of_downloads"].sum()
    return str(unique_ips), str(downloads)

def process_package(pkg):
    """Fetch and parse the HTML and stats for a single package."""
    print(f"Processing package: {pkg}")
    result = {"Package": pkg}
    html_url = f"https://www.bioconductor.org/packages/release/bioc/html/{pkg}.html"
    stats_url = f"https://bioconductor.org/packages/stats/bioc/{pkg}/{pkg}_stats.tab"

    html_text = fetch_url(html_url)
    if html_text:
        pkg_data = parse_html(html_text)
        result.update(pkg_data)
    else:
        # In case of error, leave the fields empty.
        result.update({
            "DOI": "",
            "Description": "",
            "Version": "",
            "In Bioconductor since": "",
            "Imports": "",
            "Suggests": "",
            "biocViews": "",
            "URL": "",
            "Authors": "",
            "Maintainer": ""
        })

    stats_text = fetch_url(stats_url)
    if stats_text:
        unique_ips, downloads = parse_stats(stats_text)
        result["Unique_IPs_2024"] = unique_ips
        result["Downloads_2024"] = downloads
    else:
        result["Unique_IPs_2024"] = ""
        result["Downloads_2024"] = ""

    return result

def main():
    parser = argparse.ArgumentParser(
        description="Fetch Bioconductor package info and download stats."
    )
    parser.add_argument("--packages", type=str, required=True,
                        help="Path to a text file with package names (one per line)")
    parser.add_argument("--output", type=str, default="results.csv",
                        help="Output CSV file path")
    parser.add_argument("--chunk", type=int, default=0,
                        help="Chunk index (starting from 0) for parallel jobs")
    parser.add_argument("--total-chunks", type=int, default=1,
                        help="Total number of chunks (parallel jobs)")
    args = parser.parse_args()

    # Read package names.
    with open(args.packages, "r") as f:
        all_packages = [line.strip() for line in f if line.strip()]

    # Split into chunks for SLURM if needed.
    if args.total_chunks > 1:
        packages = [pkg for i, pkg in enumerate(all_packages) if i % args.total_chunks == args.chunk]
        print(f"Processing chunk {args.chunk} out of {args.total_chunks} total chunks.")
    else:
        packages = all_packages

    results = []
    for pkg in packages:
        res = process_package(pkg)
        results.append(res)

    # Create DataFrame and ensure column order.
    df = pd.DataFrame(results)
    df.to_csv(args.output, index=False)
    print(f"Results saved to {args.output}")

if __name__ == "__main__":
    main()
