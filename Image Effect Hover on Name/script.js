console.clear();
const elApp = document.querySelector("#app");

document.body.addEventListener("mousemove", (event) => {
  console.log({
    x: event.clientX,
    y: event.clientY
  });

  elApp.style.setProperty("--x", event.clientX);
  elApp.style.setProperty("--y", event.clientY);
});

let el = document.body;
el.addEventListener("click", function (e) {
  el.hidden = true;
  requestAnimationFrame(() => {
    el.hidden = false;
  });
});
