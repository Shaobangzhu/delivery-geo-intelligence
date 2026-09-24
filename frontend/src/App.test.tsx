import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

vi.mock("./pages/Dashboard", () => ({ Dashboard: () => <h1>Dashboard page</h1> }));
vi.mock("./pages/History", () => ({ History: () => <h1>History page</h1> }));
vi.mock("./pages/Merchants", () => ({ Merchants: () => <h1>Merchants page</h1> }));

it("provides exactly three primary navigation routes with active state", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/merchants"]}><App /></MemoryRouter>);
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((link) => link.textContent)).toEqual(["Dashboard", "History", "Merchants"]);
  expect(screen.getByRole("heading", { name: "Merchants page" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Merchants" })).toHaveClass("active");
  await user.click(screen.getByRole("link", { name: "History" }));
  expect(screen.getByRole("heading", { name: "History page" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "History" })).toHaveClass("active");
  await user.click(screen.getByRole("link", { name: "Dashboard" }));
  expect(screen.getByRole("heading", { name: "Dashboard page" })).toBeInTheDocument();
});
