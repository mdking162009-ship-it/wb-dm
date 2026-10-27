// quedas de rede em qualquer motor: pausar em vez de falhar
export function isNetError(msg: string): boolean {
  return /ENOTFOUND|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|failed to resolve|gai error|connection (was )?(reset|lost|closed)|unable to (connect|contact|download webpage|resolve)|network|temporary failure|name resolution|fetch failed|read (timed out|timeout)|HTTP 000/i.test(
    msg
  )
}
