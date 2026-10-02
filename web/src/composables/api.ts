/** A failed request: the server's own message, its status, and the field it is about. */
export class ApiError extends Error {
  status: number
  field?: string

  constructor(message: string, status: number, field?: string) {
    super(message)
    this.status = status
    this.field = field
  }
}

export async function api<T>(
  path: string,
  init: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<T> {
  const form = init.body instanceof FormData
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined || form
          ? {}
          : { "content-type": "application/json" }),
        ...init.headers,
      },
      body:
        init.body === undefined
          ? undefined
          : form
            ? (init.body as FormData)
            : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(
      "The server could not be reached. Check your connection and try again.",
      0,
    )
  }
  const data = await res.json().catch(() => null)
  if (!res.ok)
    throw new ApiError(
      data?.error ?? `The server answered ${res.status}.`,
      res.status,
      data?.field,
    )
  return data as T
}
