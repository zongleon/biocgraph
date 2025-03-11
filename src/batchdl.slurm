#!/bin/bash
#SBATCH --job-name=biocgraph
#SBATCH --output=bioc_scrape_%a.out
#SBATCH --error=bioc_scrape_%a.err
#SBATCH --array=0-3
#SBATCH --time=12:00:00
#SBATCH --mem=4G

python dl.py --packages avail.txt --output results_${SLURM_ARRAY_TASK_ID}.csv --chunk ${SLURM_ARRAY_TASK_ID} --total-chunks 4
