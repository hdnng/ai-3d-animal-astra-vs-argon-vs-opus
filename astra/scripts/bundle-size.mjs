import { readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const files = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(name);
    else {
      const content = await readFile(name);
      files.push({
        path: name.replaceAll("\\", "/"),
        bytes: content.length,
        gzipBytes: gzipSync(content).length,
      });
    }
  }
}
await visit("dist");
const result = {
  files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
};
await writeFile("build-results.json", JSON.stringify(result, null, 2));
console.log(
  `Total production payload: ${(result.totalBytes / 1000).toFixed(2)} kB; ${(result.totalGzipBytes / 1000).toFixed(2)} kB gzip.`,
);
