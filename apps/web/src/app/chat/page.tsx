// The conversation list itself lives in the persistent layout shell
// (chat-shell.tsx). This route only supplies the right-pane content shown
// on desktop when no thread is selected — on mobile the shell shows the
// list instead of this page.
export default function ChatIndexPage() {
  return (
    <div className="hidden flex-1 items-center justify-center text-sm text-muted md:flex">
      <p>Select a conversation</p>
    </div>
  );
}
