console.clear();

const elShoes = document.querySelectorAll(".shoe");

[...elShoes].forEach((shoe) => {
  shoe.addEventListener("click", () => {
    [...document.querySelectorAll(".shoe[data-active]")].forEach(
      (el) => delete el.dataset.active
    );

    shoe.dataset.active = true;
  });
});
