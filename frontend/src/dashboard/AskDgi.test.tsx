import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AskDgi } from "./AskDgi";

const answer = { requestId: "synthetic", answer: "Recorded payout: 0 USD\nProfit: unavailable <script>unsafe()</script>",
  toolsUsed: ["get_session_efficiency"], warnings: ["Recorded observations only."] };
afterEach(() => vi.unstubAllGlobals());
async function open() { const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Open analyst" })); return user; }

it("opens/closes, focuses suggestions and makes no requests until explicit submission", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<AskDgi />);
  expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  const user = await open(); await user.click(screen.getByRole("button", { name: "What data should I backfill?" }));
  expect(screen.getByLabelText("Your question")).toHaveValue("What data should I backfill?"); expect(screen.getByLabelText("Your question")).toHaveFocus(); expect(fetch).not.toHaveBeenCalled();
  await user.keyboard("{Escape}"); expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Open analyst" })).toHaveFocus();
});
it("validates blank questions, prevents duplicate submission and safely renders grounded plain text", async () => {
  let finish!: (value: unknown) => void;
  const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetch); render(<AskDgi />); const user = await open();
  await user.click(screen.getByRole("button", { name: "Ask" })); expect(screen.getByRole("alert")).toHaveTextContent("Enter a question"); expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "How efficient were my delivery sessions?" }));
  const form = screen.getByLabelText("Your question").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Reading recorded analytics"); expect(screen.getByRole("button", { name: "Analyzing…" })).toBeDisabled();
  const init = fetch.mock.calls[0][1] as RequestInit; expect(JSON.parse(init.body as string)).toEqual({ question: "How efficient were my delivery sessions?" });
  await act(async () => finish({ ok: true, json: async () => answer }));
  expect(await screen.findByRole("region", { name: "DGI answer" })).toHaveTextContent("0 USD"); expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("Sources: Session efficiency")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Your question"), " New question"); expect(screen.queryByRole("region", { name: "DGI answer" })).not.toBeInTheDocument();
});
it("handles configuration/provider errors and retries only by user action", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => answer }); vi.stubGlobal("fetch", fetch); render(<AskDgi />);
  const user = await open(); await user.type(screen.getByLabelText("Your question"), "Explain my session"); await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable"); expect(fetch).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Retry analysis" })); await screen.findByRole("region", { name: "DGI answer" }); expect(fetch).toHaveBeenCalledTimes(2);
});
it("cancels on close/unmount and ignores stale completions after reopening", async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise((resolve) => resolvers.push(resolve))); vi.stubGlobal("fetch", fetch);
  const view = render(<AskDgi />); const user = await open(); await user.type(screen.getByLabelText("Your question"), "First"); await user.click(screen.getByRole("button", { name: "Ask" }));
  const firstSignal = fetch.mock.calls[0][1].signal as AbortSignal;
  await user.click(screen.getByRole("button", { name: "Close analyst" })); expect(firstSignal.aborted).toBe(true);
  await open(); await user.click(screen.getByRole("button", { name: "Ask" }));
  await act(async () => resolvers[0]({ ok: true, json: async () => answer })); expect(screen.queryByRole("region", { name: "DGI answer" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Analyzing…" })).toBeDisabled(); view.unmount(); expect((fetch.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
});
