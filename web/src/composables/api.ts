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

/**
 * Calls the server under `/api` and returns its JSON. A body makes it a POST.
 *
 * Every failure throws an ApiError whose message can be shown as it is: the
 * server writes its errors for people, and a network failure gets one here.
 * The session cookie travels on its own (same origin); `headers` carries
 * anything else, such as a respondent's attempt token.
 */
export async function api<T>(
  path: string,
  init: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<T> {
  // A FormData body (file uploads) goes as multipart, with the browser
  // setting its boundary; anything else goes as JSON.
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
