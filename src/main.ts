import "./style.css";
import { mountApp } from "./ui/app.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  mountApp(app);
}
