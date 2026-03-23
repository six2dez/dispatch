import JSZip from "jszip";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

function addDirToZip(zip, dirPath, zipPath) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    if (entry.endsWith('.zip') || entry.endsWith('.sig')) continue;
    const fullPath = join(dirPath, entry);
    const entryZipPath = zipPath ? `${zipPath}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) {
      addDirToZip(zip, fullPath, entryZipPath);
    } else {
      zip.file(entryZipPath, readFileSync(fullPath));
    }
  }
}

async function pack() {
  const zip = new JSZip();

  // Add manifest
  zip.file("manifest.json", readFileSync("manifest.json"));

  // Add dist files
  if (existsSync("dist")) {
    addDirToZip(zip, "dist", "");
  }

  const content = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync("dist/dispatch.zip", content);
  console.log("Created dist/dispatch.zip");
}

pack().catch(console.error);
