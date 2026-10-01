import { createApp } from "vue"
import App from "./App.vue"
import { router } from "./router"
import { initTheme } from "./composables/theme"
// DM Sans from the package rather than Google Fonts, so it works offline.
import "@fontsource-variable/dm-sans"
import "./style.css"

// The chosen theme goes on <html> before anything draws.
initTheme()

createApp(App).use(router).mount("#app")
