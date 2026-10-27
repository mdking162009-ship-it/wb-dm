# WB-DM — White Black Download Manager

Gerenciador de downloads para Windows, rápido e sem publicidade. Baixa ficheiros em
**várias conexões em paralelo** (até 16, à maneira do IDM), organiza tudo em pastas por
tipo e monitoriza a área de transferência para capturar links automaticamente.

## Porquê o WB-DM?

- **Downloads multi-conexão** — o arquivo é dividido em segmentos e baixado ao mesmo
  tempo por várias conexões. Em servidores que suportam `Range`, a velocidade multiplica
- **Organização automática** — cada ficheiro é salvo na subpasta certa: Vídeos, Imagens,
  Áudios, Documentos, Arquivos, Programas ou Outros
- **Capturador de links** — copias um link em qualquer app e o WB-DM avisa, com opção
  de baixar na hora
- **Pausar e retomar a sério** — cada segmento retoma do ponto exacto onde parou
- **Dois temas** — claro (White) e escuro (Black), à escolha do utilizador
- **Grátis** — sem contas, sem telemetria, sem anúncios

## Instalação

1. Vai à página de [Releases](../../releases)
2. Baixa o `WB-DM Setup 1.0.0.exe` da última versão
3. Instala e usa

> O Windows SmartScreen pode avisar na primeira abertura (o instalador ainda não tem
> certificado de assinatura). Clica em "Mais informações" → "Executar assim mesmo".

## Compilar a partir do código-fonte

```bash
npm install        # dependências
npm run dev        # modo de desenvolvimento
npm run build:win  # instalador Windows (fica em release/)
npm run icon       # regenera os ícones a partir de build/icon.png
```

## Apoiar o projecto

O WB-DM é gratuito e vai continuar a ser. Se ele te poupa tempo e largura de banda,
agradeço-te: [Paga-me um café](https://ko-fi.com/) — doa o que quiseres, se quiseres.

## Licença

[MIT](LICENSE)
