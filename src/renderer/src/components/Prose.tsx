import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Model text rendered as markdown (GFM). Links open in the system browser; raw HTML is never rendered. */
export function Prose({ text }: { text: string }) {
  return (
    <div className="prose md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href && /^https?:\/\//.test(href)) window.open(href, '_blank')
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

