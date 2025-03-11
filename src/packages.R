if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager")

avail <- BiocManager::available()

# output to file
write.table(avail, file = "avail.txt", quote = FALSE, row.names = FALSE, col.names = FALSE)