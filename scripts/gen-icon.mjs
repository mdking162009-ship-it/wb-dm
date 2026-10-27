// gera icon@2x + icon.ico a partir do build/icon.png (fonte de verdade, 1024x1024)
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const build = join(projectRoot, 'build')
const master = join(build, 'icon.png')

const render = (size) => sharp(master).resize(size, size).png().toBuffer()

writeFileSync(join(build, 'icon@2x.png'), await render(512))
const icoSizes = [256, 128, 64, 48, 32, 16]
const ico = await pngToIco(await Promise.all(icoSizes.map(render)))
writeFileSync(join(build, 'icon.ico'), ico)
copyFileSync(master, join(projectRoot, 'resources', 'icon.png'))

console.log('icone aplicado: icon.ico (6 tamanhos) + icon@2x 512 + resources\\icon.png')
