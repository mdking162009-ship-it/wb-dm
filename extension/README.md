# Extensão WB-DM (Chrome / Edge / Brave)

Encaixa no navegador à maneira do IDM: clicas num link (ou vídeo/imagem), botão
direito → "Baixar com WB-DM" e o app de PC recebe e começa a baixar.

## Instalar

1. `chrome://extensions` na barra de endereço (Edge: `edge://extensions`)
2. Ativa **Modo de desenvolvedor**
3. **Carregar sem empacotamento** → escolhe esta pasta `extension/`
4. Abre o WB-DM no PC; o quadradinho de estado no popup fica verde quando conectado

Uso: clicas com o botão direito em qualquer link, vídeo ou imagem → **Baixar com WB-DM**.
Os interruptores do popup controlam que sites e tipos de ficheiro a extensão captura.

Nota: a extensão fala com o app no `127.0.0.1:28123` — nada sai do teu PC.
