import { isValidElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, ExternalLink, ZoomIn } from 'lucide-react';
import {
  remarkHeadingIds,
  resolveGuideImage,
  resolveGuideLink,
} from '@/lib/documentation';

function SequenceDiagram({ source }: { source: string }) {
  const participants = new Map<string, string>();
  const steps: { from: string; to: string; message: string }[] = [];
  for (const line of source.split('\n')) {
    const participant = /^\s*participant (\w+) as (.+)$/.exec(line);
    if (participant) participants.set(participant[1], participant[2]);
    const step = /^\s*(\w+)-{1,2}>>(\w+): (.+)$/.exec(line);
    if (step)
      steps.push({
        from: participants.get(step[1]) ?? step[1],
        to: participants.get(step[2]) ?? step[2],
        message: step[3],
      });
  }
  if (!steps.length)
    return (
      <pre>
        <code>{source}</code>
      </pre>
    );
  return (
    <figure className="doc-sequence">
      <figcaption>Credential use, step by step</figcaption>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            <div>
              <strong>{step.from}</strong>
              <ArrowRight aria-hidden="true" />
              <strong>{step.to}</strong>
            </div>
            <p>{step.message}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export default function GuideContent({
  content,
  file,
}: {
  content: string;
  file: string;
}) {
  return (
    <article className="documentation-content">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkHeadingIds]}
        components={{
          a: ({ href, children }) => {
            const target = href && resolveGuideLink(file, href);
            if (!target) return <span>{children}</span>;
            if (target.startsWith('/documentation/'))
              return <Link to={target}>{children}</Link>;
            return (
              <a href={target} target="_blank" rel="noopener noreferrer">
                {children}
                <ExternalLink className="doc-external" aria-hidden="true" />
              </a>
            );
          },
          img: ({ src, alt }) => {
            const target = src && resolveGuideImage(file, src);
            if (!target) return <span>{alt || 'Image unavailable'}</span>;
            return (
              <a
                href={target}
                target="_blank"
                rel="noopener noreferrer"
                className="doc-screenshot"
                aria-label={`Open screenshot: ${alt || 'documentation screenshot'}`}
              >
                <img src={target} alt={alt ?? ''} loading="lazy" />
                <span>
                  <ZoomIn aria-hidden="true" />
                  Open full-size screenshot
                </span>
              </a>
            );
          },
          table: ({ children }) => (
            <div className="doc-table">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => {
            if (
              isValidElement<{ className?: string; children?: ReactNode }>(
                children,
              ) &&
              children.props.className === 'language-mermaid'
            )
              return (
                <SequenceDiagram
                  source={String(children.props.children ?? '')}
                />
              );
            return <pre>{children}</pre>;
          },
        }}
      >
        {content}
      </Markdown>
    </article>
  );
}
