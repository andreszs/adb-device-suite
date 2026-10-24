import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import png2icons from "png2icons";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "build", "icon.svg");
const pngPath = path.join(root, "build", "icon.png");
const icoPath = path.join(root, "build", "icon.ico");
const icnsPath = path.join(root, "build", "icon.icns");
const appxDir = path.join(root, "build", "appx");

const png = await sharp(source).resize(1024, 1024).png().toBuffer();
await fs.writeFile(pngPath, png);
await fs.writeFile(icoPath, await pngToIco(png));

const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
if (!icns) throw new Error("Could not create the macOS icon.");
await fs.writeFile(icnsPath, icns);

await fs.mkdir(appxDir, { recursive: true });

async function writeAppxAsset(fileName, width, height, artworkSize = Math.min(width, height)) {
  const artwork = await sharp(source)
    .resize(artworkSize, artworkSize, { fit: "contain" })
    .png()
    .toBuffer();

  const image = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: artwork,
      left: Math.floor((width - artworkSize) / 2),
      top: Math.floor((height - artworkSize) / 2),
    }])
    .png()
    .toBuffer();

  await fs.writeFile(path.join(appxDir, fileName), image);
}

await Promise.all([
  writeAppxAsset("StoreLogo.png", 50, 50, 46),
  writeAppxAsset("Square44x44Logo.png", 44, 44, 40),
  writeAppxAsset("Square150x150Logo.png", 150, 150, 132),
  writeAppxAsset("Wide310x150Logo.png", 310, 150, 132),
]);

console.log("Generated desktop icons and Microsoft Store tile assets");
