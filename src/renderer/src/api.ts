import type { Api } from '../../shared/types'

export const api = (window as unknown as { api: Api }).api
