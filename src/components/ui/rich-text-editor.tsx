"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Undo, Redo } from "lucide-react";

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`rounded p-1.5 ${active ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-black/5 hover:text-text"} disabled:pointer-events-none disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

/**
 * Restrained rich-text body editor for the composer and template editor —
 * paragraphs, bold, italic, links, bulleted/numbered lists, undo/redo, and
 * safe paste (Tiptap/ProseMirror only ever parses pasted content into
 * nodes/marks this editor's own schema recognizes — StarterKit here has
 * headings/code blocks/blockquotes/strikethrough/horizontal rules
 * deliberately disabled, so pasted rich content is downgraded to plain
 * paragraphs+lists+bold/italic/links rather than passed through). Emits
 * real HTML via `onChange` — see src/lib/comms/sanitize-html.ts's
 * sanitizeEmailHtml() (which this editor's allowlist must stay in sync
 * with) for how that HTML is re-sanitized server-side before ever being
 * sent, and templates.ts's resolveTemplatePlaceholders() "html" context
 * for how merge-field values get safely spliced into it.
 *
 * Renders a `name`d hidden input carrying the current HTML so a plain
 * `<form action={...}>` submission (this app's convention — no client-side
 * fetch/JSON) still includes it under FormData.get(name), exactly like the
 * `<Textarea name="body">` it replaces.
 */
export function RichTextEditor({
  name,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "rich-text-content px-3 py-2 focus:outline-none min-h-32",
      },
    },
  });

  // Keeps the editor in sync when `value` changes from OUTSIDE user typing
  // (selecting a template auto-fills the body, or the edit page loads an
  // existing template) -- guarded by the equality check so this never
  // fights the user's own keystrokes, which already flow the other
  // direction via onUpdate above.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div className="rounded-lg border border-border-strong bg-surface">
      <input type="hidden" name={name} value={value} />
      {editor && (
        <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
          <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={editor.isActive("link")}
            onClick={() => {
              const previousUrl = (editor.getAttributes("link").href as string | undefined) ?? "";
              const url = window.prompt("Link URL (leave blank to remove)", previousUrl);
              if (url === null) return;
              const chain = editor.chain().focus().extendMarkRange("link");
              if (url.trim() === "") {
                chain.unsetLink().run();
              } else {
                chain.setLink({ href: url.trim() }).run();
              }
            }}
          >
            <LinkIcon size={14} />
          </ToolbarButton>
          <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={14} />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={14} />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
            <Undo size={14} />
          </ToolbarButton>
          <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
            <Redo size={14} />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
