import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Pagination } from "./Pagination";
import { pageNumbers, pageRange } from "./pageRange";

it.each([0, 1, 10, 11, 20, 21])("paginates %i rows with correct ranges and boundaries", async (total) => {
  function Table() {
    const [page, setPage] = useState(1);
    return <Pagination page={page} total={total} noun="rows" label="Test pages" onPageChange={setPage} />;
  }
  const user = userEvent.setup(); render(<Table />);
  const nav = within(screen.getByRole("navigation", { name: "Test pages" }));
  const count = Math.ceil(total / 10);
  expect(nav.getAllByRole("button")).toHaveLength(count + 2);
  expect(nav.getByRole("button", { name: "Previous page" })).toBeDisabled();
  for (let page = 1; page <= Math.max(1, count); page++) {
    const start = total ? (page - 1) * 10 + 1 : 0;
    expect(screen.getByText(`Showing ${start}${total ? `–${Math.min(page * 10, total)}` : ""} of ${total} rows`)).toBeInTheDocument();
    if (count) expect(nav.getByRole("button", { name: `Page ${page}` })).toHaveAttribute("aria-current", "page");
    if (page < count) await user.click(nav.getByRole("button", { name: "Next page" }));
  }
  expect(nav.getByRole("button", { name: "Next page" })).toBeDisabled();
  if (count > 1) {
    await user.click(nav.getByRole("button", { name: "Previous page" }));
    expect(nav.getByRole("button", { name: `Page ${count - 1}` })).toHaveAttribute("aria-current", "page");
    await user.click(nav.getByRole("button", { name: "Page 1" }));
    expect(nav.getByRole("button", { name: "Previous page" })).toBeDisabled();
  }
});

it("retains the five-page window and clamps invalid pages including empty data", () => {
  expect(pageNumbers(8, 9)).toEqual([5, 6, 7, 8, 9]);
  expect(pageNumbers(4, 9)).toEqual([2, 3, 4, 5, 6]);
  expect(pageRange(3, 20)).toEqual({ page: 2, totalPages: 2, offset: 10, start: 11, end: 20 });
  expect(pageRange(8, 0)).toEqual({ page: 1, totalPages: 0, offset: 0, start: 0, end: 0 });
});

it("disables all navigation while loading", async () => {
  const change = vi.fn();
  render(<Pagination page={2} total={21} noun="rows" label="Loading pages" disabled onPageChange={change} />);
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(change).not.toHaveBeenCalled();
});
