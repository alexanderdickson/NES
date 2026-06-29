import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main>
      <h1>NES</h1>
      <p>A NES emulator in TypeScript. Project scaffold is up and running.</p>
    </main>
  `;
}
