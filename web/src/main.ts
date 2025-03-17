import './style.css'
import Graph from "graphology";
import { parse } from "graphology-gexf/browser";
import Sigma from "sigma";
import { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import { EdgeArrowProgram } from "sigma/rendering";
import Fuse from "fuse.js";

interface State {
  searchQuery: string;

  // State derived from query:
  selectedNode?: string;
  suggestions?: Set<string>;
  selectedNeighbors?: Set<string>;

  // filter state
  biocTypeFilter?: string;
}

// Retrieve some useful DOM elements:
const container = document.getElementById("sigma-container") as HTMLElement;
const zoomInBtn = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomResetBtn = document.getElementById("zoom-reset") as HTMLButtonElement;
const labelsThresholdRange = document.getElementById("labels-threshold") as HTMLInputElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchSuggestions = document.getElementById("suggestions") as HTMLDataListElement;
const sidebar = document.getElementById("node-sidebar") as HTMLDivElement;
const biocFilter = document.getElementById("filter-input") as HTMLSelectElement;
const biocFilterSuggestions = document.getElementById("filter-suggestions") as HTMLDataListElement;

// get user dark mode pref
let darkmode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

if (darkmode) {
  // User prefers dark mode
  document.body.classList.add('dark-mode');
} else {
  // User prefers light mode or has no preference
  document.body.classList.remove('dark-mode');
}

// Add dark mode toggle functionality:
const darkModeToggleBtn = document.getElementById("dark-mode-toggle") as HTMLButtonElement;
darkModeToggleBtn.addEventListener("click", () => {
	darkmode = !darkmode;
	document.body.classList.toggle("dark-mode", darkmode);
	// Refresh sigma to update node colors based on new darkmode
	renderer.refresh({ skipIndexation: true });
});

// Load external GEXF file:
const res = await fetch("./graph.gexf");
const gexf = await res.text();

// Parse GEXF string:
const graph = parse(Graph, gexf);

// Instantiate sigma:
const renderer = new Sigma(graph, container, {
  minCameraRatio: 0.08,
  maxCameraRatio: 3,
  labelRenderedSizeThreshold: 3,
  defaultEdgeType: "straightArrow",
  edgeProgramClasses: {
    straightArrow: EdgeArrowProgram,
  },
});
const camera = renderer.getCamera();

// Bind zoom manipulation buttons
zoomInBtn.addEventListener("click", () => {
  camera.animatedZoom({ duration: 600 });
});
zoomOutBtn.addEventListener("click", () => {
  camera.animatedUnzoom({ duration: 600 });
});
zoomResetBtn.addEventListener("click", () => {
  camera.animatedReset({ duration: 600 });
});

// Bind labels threshold to range input
labelsThresholdRange.addEventListener("input", () => {
  renderer?.setSetting("labelRenderedSizeThreshold", +labelsThresholdRange.value);
});

// Set proper range initial value:
labelsThresholdRange.value = renderer.getSetting("labelRenderedSizeThreshold") + "";

// Type and declare internal state:
const state: State = { searchQuery: "" };

// Feed the datalist autocomplete values:
searchSuggestions.innerHTML = graph
.nodes()
.map((node) => `<option value="${graph.getNodeAttribute(node, "label")}"></option>`)
.join("\n");

// initialize fuse for search
const nodes = graph.nodes().map((n) => ({ id: n, label: graph.getNodeAttribute(n, "label") as string }));
const fuse = new Fuse(nodes, {
  keys: ["label"],
  threshold: 0.3,
});

// Bind search input interactions:
searchInput.addEventListener("input", () => {
  setSearchQuery(searchInput.value || "");
});
searchInput.addEventListener("blur", () => {
  setSearchQuery("");
});

// initialize filter options
// biocViews are in the biocViews attribute and are comma separated
const biocViews = new Set<string>();
const noBiocViewLabel = "No biocViews";
const onlyBiocViews = "Has biocViews";
biocViews.add("---");
biocViews.add(noBiocViewLabel);
biocViews.add(onlyBiocViews);
graph.nodes().forEach((node) => {
  const views = graph.getNodeAttribute(node, "biocViews") as string;
  if (views === undefined) return;
  views.split(",").forEach((view) => biocViews.add(view.trim()));
});
// feed filter input with suggestinos
biocFilterSuggestions.innerHTML = Array.from(biocViews)
  .map((view) => `<option value="${view}"></option>`)
  .join("\n");

// bind filter interactions
biocFilter.addEventListener("change", () => {
  filterNodes(biocFilter.value);
});

// Bind graph interactions:
renderer.on("clickNode", ({ node }) => {
  if (state.selectedNode === node) {
    setSearchQuery("");
  } else {
    setSearchQuery(node);
  }
});
document.onkeyup = (e) => {
  if (e.key === "Escape") {
    setSearchQuery("");
  }
}

renderer.setSetting("nodeReducer", (node, data) => {
  const res: Partial<NodeDisplayData> = { ...data };
  let color = darkmode ? "#ccc" : "#f6f6f6";

  if (state.selectedNeighbors && !state.selectedNeighbors.has(node) && state.selectedNode !== node) {
    res.label = "";
    res.color = color;
  }

  if (state.selectedNode === node) {
    res.highlighted = true;
  } else if (state.suggestions) {
    if (state.suggestions.has(node)) {
      res.forceLabel = true;
    } else {
      res.label = "";
      res.color = color;
    }
  }

  // filter by biocView
  if (state.biocTypeFilter) {
    if (state.biocTypeFilter === noBiocViewLabel) {
      if (graph.getNodeAttribute(node, "biocViews") !== undefined) {
        res.hidden = true;
      }
    } else if (state.biocTypeFilter === onlyBiocViews) {
      if (graph.getNodeAttribute(node, "biocViews") === undefined) {
        res.hidden = true;
      }
    } else if (!graph.getNodeAttribute(node, "biocViews")?.includes(state.biocTypeFilter)) {
        res.hidden = true; 
    }
  }

  return res;
});

// Render edges accordingly to the internal state:
// 1. If a node is selected, the edge is hidden if it is not connected to the
//    node
// 2. If there is a query, the edge is only visible if it connects two
//    suggestions
renderer.setSetting("edgeReducer", (edge, data) => {
  const res: Partial<EdgeDisplayData> = { ...data };

  if (
    state.selectedNode &&
    !graph.extremities(edge).every((n) => n === state.selectedNode || graph.areNeighbors(n, state.selectedNode))
  ) {
    res.hidden = true;
  }

  if (
    state.suggestions &&
    (!state.suggestions.has(graph.source(edge)) || !state.suggestions.has(graph.target(edge)))
  ) {
    res.hidden = true;
  }

  // Set edge color to be the same as the source node color
  // const sourceNodeColor = graph.getNodeAttribute(graph.source(edge), "color");
  // if (sourceNodeColor) {
  //   res.color = sourceNodeColor.replace("rgb", "rgba").replace(")", ", 0.6)");
  // }

  return res;
});

// Actions:
function setSearchQuery(query: string) {
  state.searchQuery = query;

  if (searchInput.value !== query) searchInput.value = query;

  if (query) {
    const suggestions = fuse.search(query).map((result) => result.item);

    // If we have a single perfect match, then we remove the suggestions, and
    // we consider the user has selected a node through the datalist
    // autocomplete:
    if (nodes.find((n) => n.label === query) !== undefined || suggestions.length === 1) {
      if (suggestions.length === 1) {
        query = suggestions[0].id;
      }
      state.selectedNode = query;
      state.suggestions = undefined;

      // and set the neighbors
      state.selectedNeighbors = new Set(graph.neighbors(query));

      // Move the camera to center it on the selected node:
      // const nodePosition = renderer.getNodeDisplayData(state.selectedNode) as Coordinates;
      // renderer.getCamera().animate(nodePosition, {
      //   duration: 500,
      // });
    }
    // Else, we display the suggestions list:
    else {
      state.selectedNode = undefined;
      state.suggestions = new Set(suggestions.map(({ id }) => id));
      state.selectedNeighbors = undefined;
    }
  }
  // If the query is empty, then we reset the selectedNode / suggestions state:
  else {
    state.selectedNode = undefined;
    state.suggestions = undefined;
    state.selectedNeighbors = undefined;
  }

  if (state.selectedNode !== undefined) {
    makeSidebar(sidebar);
  } else {
    sidebar.style.display = "none";
  }

  // Refresh rendering
  // You can directly call `renderer.refresh()`, but if you need performances
  // you can provide some options to the refresh method.
  // In this case, we don't touch the graph data so we can skip its reindexation
  renderer.refresh({
    skipIndexation: true,
  });
}

function makeSidebar(sidebar: HTMLElement) {
  const label = graph.getNodeAttribute(state.selectedNode, "label");
  const version = graph.getNodeAttribute(state.selectedNode, "Version");
  const biocVersion = graph.getNodeAttribute(state.selectedNode, "BioC_version");
  const biocYear = graph.getNodeAttribute(state.selectedNode, "BioC_year");
  const description = graph.getNodeAttribute(state.selectedNode, "Description");
  const uniqueIPs = graph.getNodeAttribute(state.selectedNode, "Unique_IPs_2024");
  const biocViews = graph.getNodeAttribute(state.selectedNode, "biocViews");
  const url = graph.getNodeAttribute(state.selectedNode, "URL");
  const doi = graph.getNodeAttribute(state.selectedNode, "DOI");
  const authors = graph.getNodeAttribute(state.selectedNode, "Authors");
  
  if (doi === undefined) {
    // not a bioconductor package
    sidebar.innerHTML = `
      <button id="close-sidebar" class="close-btn">X</button>
      <h2>${label}</h2>
      <p>
        Probably an R package. 
        <a target="_blank" rel="noopener noreferrer" href="http://rdocumentation.org/packages/${label}">More info</a>
      </p>`;
  } else {
    sidebar.innerHTML = `
      <button id="close-sidebar" class="close-btn">X</button>
      <h2>${label}</h2>
      <ul>
        <li><strong>Version:</strong> ${version}</li>
        <li><strong>BioC_version:</strong> ${biocVersion}</li>
        <li><strong>BioC_year:</strong> ${biocYear}</li>
        <li><strong>Description:</strong> ${description}</li>
        <li><strong>Unique_IPs_2024:</strong> ${uniqueIPs}</li>
        <li><strong>biocViews:</strong> ${biocViews}</li>
        <li><strong>URL:</strong> ${url}</li>
        <li><strong>DOI:</strong> ${doi}</li>
        <li><strong>Authors:</strong> ${authors}</li>
      </ul>`;
  }
  // Append resizer element for sidebar resizing:;
  sidebar.innerHTML += `<div id="sidebar-resizer"></div>`;
  sidebar.style.display = "block";
  // Bind close button to clear selected node and hide sidebar
  document.getElementById("close-sidebar")?.addEventListener("click", () => {
    setSearchQuery("");
  });
  
  // Setup sidebar resizing:
  const resizer = document.getElementById("sidebar-resizer");
  if (resizer) {
    let startPos: number, startSize: number;
    const isMobile = window.innerWidth <= 600;
    const mouseMoveHandler = (e: MouseEvent) => {
      if (isMobile) {
        const dy = e.clientY - startPos;
        const newHeight = Math.max(150, startSize - dy);
        sidebar.style.height = newHeight + "px";
      } else {
        const dx = e.clientX - startPos;
        const newWidth = Math.max(200, startSize + dx);
        sidebar.style.width = newWidth + "px";
      }
    }
    const mouseUpHandler = () => {
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("mouseup", mouseUpHandler);
    }
    resizer.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      if (isMobile) {
        startPos = e.clientY;
        startSize = sidebar.clientHeight;
      } else {
        startPos = e.clientX;
        startSize = sidebar.clientWidth;
      }
      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
    });
  }
}

function filterNodes(filter: string) {
  state.biocTypeFilter = filter;
  if (state.biocTypeFilter === "---") {
    state.biocTypeFilter = undefined;
  }
  renderer.refresh({ skipIndexation: true });
}