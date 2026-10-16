/** Model text as pre-wrapped prose; ``` fences become code blocks (an unclosed fence while streaming still renders as code). */
export function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/```[\w+.-]*\n?/).map((part, i) =>
        i % 2 ? (
          <pre key={i}>
            <code>{part.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          part.replace(/^\n+|\n+$/g, '')
        )
      )}
    </div>
  )
}
