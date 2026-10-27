import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColourPicker } from "./ColourPicker";

describe("ColourPicker", () => {
  it("offers palette colours and restores focus after choosing one", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<ColourPicker label="Page colour" value="#ffffff" onChange={change} />);
    const trigger = screen.getByRole("button", { name: "Page colour" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Page colour picker" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cream (#fff4d6)" }));
    expect(change).toHaveBeenCalledWith("#fff4d6");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("commits shorthand hex only on Enter and rejects invalid input", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<ColourPicker label="Pen colour" value="#000000" onChange={change} />);
    await user.click(screen.getByRole("button", { name: "Pen colour" }));
    const field = screen.getByRole("textbox", { name: "Pen colour hex code" });
    await user.clear(field);
    await user.type(field, "#aBc");
    expect(change).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(change).toHaveBeenCalledWith("#aabbcc");
    change.mockClear();
    await user.clear(field);
    await user.type(field, "invalid{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a hex colour");
    expect(change).not.toHaveBeenCalled();
  });

  it("supports the native colour picker and hex blur", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<ColourPicker label="Page colour" value="#ffffff" onChange={change} />);
    await user.click(screen.getByRole("button", { name: "Page colour" }));
    fireEvent.change(screen.getByLabelText("Custom page colour"), { target: { value: "#123456" } });
    expect(change).toHaveBeenCalledWith("#123456");
    const field = screen.getByRole("textbox", { name: "Page colour hex code" });
    fireEvent.change(field, { target: { value: "#789abc" } });
    fireEvent.blur(field);
    expect(change).toHaveBeenCalledWith("#789abc");
  });

  it("closes on Escape and outside clicks, and cannot open when disabled", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ColourPicker label="Page colour" value="#ffffff" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Page colour" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<ColourPicker label="Page colour" value="#ffffff" onChange={vi.fn()} disabled />);
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
