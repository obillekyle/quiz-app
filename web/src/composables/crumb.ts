import { ref } from "vue"

/**
 * The last part of the top bar's trail when only the page knows it (one
 * response: the respondent's name). The page sets it and clears it on leaving.
 */
export const pageCrumb = ref<string | null>(null)
