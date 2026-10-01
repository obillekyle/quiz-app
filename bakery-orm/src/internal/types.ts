/**
 * Types this package took from @bakery-framework/core. `MapOf`, `MixedPromise`
 * and `Wrapped` are core's `types.d.ts`; `ISFunction` was an ambient global in
 * core's `shared.d.ts`, and is an ordinary export here.
 */
export type MapOf<T> = { [key: string]: T }

export type MixedPromise<T> = Promise<T> | T

export type Wrapped<T, Args extends any[] = []> = T | ((...args: Args) => T)

export type ISFunction = {
  (value: any, type: 'string'): value is string
  (value: any, type: 'number'): value is number
  (value: any, type: 'boolean'): value is boolean
  (value: any, type: 'bigint'): value is bigint
  (value: any, type: 'symbol'): value is symbol
  (value: any, type: 'object'): value is Record<string, any>
  (value: any, type: 'array'): value is any[]
  (value: any, type: 'null'): value is null
  (value: any, type: 'undefined'): value is undefined
  (value: any, type: 'function'): value is Function
  (value: any, type?: string): boolean
  string(value: any): value is string
  number(value: any): value is number
  boolean(value: any): value is boolean
  bigint(value: any): value is bigint
  symbol(value: any): value is symbol
  object(value: any): value is MapOf<any>
  array(value: any): value is any[]
  null(value: any): value is null
  undefined(value: any): value is undefined
  function(value: any): value is Function
}
