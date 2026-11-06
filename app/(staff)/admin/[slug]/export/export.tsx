'use client';

import { Label } from '@/components/ui/label';

import { useState } from 'react';
import { adminUrl } from '../api';
import { PageHeader } from '../page-header';

// §11 / §13: CSVs are built server-side by toCsv() (I-13); these are plain download links.
export function Export({ slug }: { slug: string }) {
  const [includeVoided, setIncludeVoided] = useState(false);
  const link = (kind: string, query = '') => adminUrl(slug, `/export/${kind}${query}`);
  return (
    <>
      <div className="grid gap-[24px] min-w-0 pb-[32px] [&_button:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_button:focus-visible]:[outline-offset:3px] [&_a:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_a:focus-visible]:[outline-offset:3px] [&_input:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_input:focus-visible]:[outline-offset:3px]">
      <PageHeader title="Export data" description="Download your event data as CSV files for reporting, analysis, and record keeping." />

      <div className="flex items-start gap-[12px] max-w-[1100px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg [background:var(--card)] [&_p]:m-0 [&_p]:text-muted-foreground

          [&_p]:text-[0.82rem] [&_p]:leading-[1.6]">
        <span className="grid [place-items:center] w-[22px] h-[22px] [flex-shrink:0] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-[50%] text-fg text-[0.78rem] [font-weight:750]" aria-hidden="true">
          i
        </span>
        <p>
          Files use UTF-8 encoding and are compatible with Excel. Timestamps
          are provided in UTC and the event’s timezone, as applicable.
        </p>
      </div>

      <section className="grid gap-[18px] max-w-[1200px]">
        <div className="[&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
          <h2>Available exports</h2>
          <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.88rem] leading-[1.65]">
            Choose the data you want to download.
          </p>
        </div>

        <div className="grid gap-[14px]">
          <article className="flex items-center gap-[18px] min-w-0 p-[20px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg [background:var(--card)] [transition:border-color_150ms]

          max-[600.001px]:grid max-[600.001px]:gap-[14px] max-[600.001px]:p-[16px]

          max-[600.001px]:[grid-template-columns:42px_minmax(0px,_1fr)] [&:hover]:border-accent">
            <div className="grid [place-items:center] w-[46px] h-[46px] [flex-shrink:0] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg text-fg max-[600.001px]:w-[42px]
          max-[600.001px]:h-[42px]
 [&_svg]:w-[23px] [&_svg]:h-[23px]" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 3.75h6l4 4v12.5H6V3.75h2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 3.75v4h4M9 12h6M9 15.5h6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="grid [justify-items:start] gap-[7px] flex-1 min-w-0 max-[600.001px]:[grid-column:2] [&_h3]:m-0

          [&_h3]:text-[0.98rem] [&_h3]:font-bold [&_>_p]:m-0 [&_>_p]:text-muted-foreground [&_>_p]:text-[0.83rem]

          [&_>_p]:leading-[1.6]">
              <h3>Participants</h3>
              <p>
                Export participant records for attendance tracking and
                event administration.
              </p>
              <span className="p-[3px_7px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-sm text-muted-foreground text-[0.65rem] [font-weight:750] tracking-[0.07em]">CSV FILE</span>
            </div>

            <a
              className="button inline-flex items-center no-underline inline-flex items-center justify-center gap-[10px]

          min-h-[44px] [flex-shrink:0] p-[0px_15px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-control [background:var(--card)] text-fg [font-family:inherit]

          text-[0.82rem] [font-weight:650] no-underline [transition:border-color_150ms]

          max-[600.001px]:[grid-column:1_/_-1] max-[600.001px]:w-full max-[600.001px]:box-border

          [&:hover]:border-accent [&_span]:text-[1rem]"
              href={link('participants.csv')}
              aria-label="Download participants CSV"
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>

          <article className="flex items-center gap-[18px] min-w-0 p-[20px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg [background:var(--card)] [transition:border-color_150ms]

          max-[600.001px]:grid max-[600.001px]:gap-[14px] max-[600.001px]:p-[16px]

          max-[600.001px]:[grid-template-columns:42px_minmax(0px,_1fr)] [&:hover]:border-accent">
            <div className="grid [place-items:center] w-[46px] h-[46px] [flex-shrink:0] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg text-fg max-[600.001px]:w-[42px]
          max-[600.001px]:h-[42px]
 [&_svg]:w-[23px] [&_svg]:h-[23px]" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3.5v4m0 9v4M3.5 12h4m9 0h4M6 6l2.8 2.8m6.4 6.4L18 18M18 6l-2.8 2.8m-6.4 6.4L6 18"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </div>

            <div className="grid [justify-items:start] gap-[7px] flex-1 min-w-0 max-[600.001px]:[grid-column:2] [&_h3]:m-0

          [&_h3]:text-[0.98rem] [&_h3]:font-bold [&_>_p]:m-0 [&_>_p]:text-muted-foreground [&_>_p]:text-[0.83rem]

          [&_>_p]:leading-[1.6]">
              <h3>Scans</h3>
              <p>
                Export checkpoint scan records, including voided scans if
                selected.
              </p>
              <span className="p-[3px_7px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-sm text-muted-foreground text-[0.65rem] [font-weight:750] tracking-[0.07em]">CSV FILE</span>

              <Label className="inline-flex items-center gap-[9px] mt-[5px] text-fg text-[0.82rem] font-medium cursor-pointer

          [&_input]:w-[16px] [&_input]:h-[16px] [&_input]:m-0 [&_input]:[accent-color:var(--accent)]

          [&_input]:cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeVoided}
                  onChange={(e) => setIncludeVoided(e.target.checked)}
                />
                <span>Include voided scans</span>
              </Label>
            </div>

            <a
              className="button inline-flex items-center no-underline inline-flex items-center justify-center gap-[10px]

          min-h-[44px] [flex-shrink:0] p-[0px_15px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-control [background:var(--card)] text-fg [font-family:inherit]

          text-[0.82rem] [font-weight:650] no-underline [transition:border-color_150ms]

          max-[600.001px]:[grid-column:1_/_-1] max-[600.001px]:w-full max-[600.001px]:box-border

          [&:hover]:border-accent [&_span]:text-[1rem]"
              href={link(
                'scans.csv',
                includeVoided ? '?includeVoided=1' : '',
              )}
              aria-label="Download scans CSV"
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>

          <article className="flex items-center gap-[18px] min-w-0 p-[20px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg [background:var(--card)] [transition:border-color_150ms]

          max-[600.001px]:grid max-[600.001px]:gap-[14px] max-[600.001px]:p-[16px]

          max-[600.001px]:[grid-template-columns:42px_minmax(0px,_1fr)] [&:hover]:border-accent">
            <div className="grid [place-items:center] w-[46px] h-[46px] [flex-shrink:0] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-lg text-fg max-[600.001px]:w-[42px]
          max-[600.001px]:h-[42px]
 [&_svg]:w-[23px] [&_svg]:h-[23px]" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 19.5h16M6.5 16V10m5.5 6V4.5m5.5 11.5v-8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="grid [justify-items:start] gap-[7px] flex-1 min-w-0 max-[600.001px]:[grid-column:2] [&_h3]:m-0

          [&_h3]:text-[0.98rem] [&_h3]:font-bold [&_>_p]:m-0 [&_>_p]:text-muted-foreground [&_>_p]:text-[0.83rem]

          [&_>_p]:leading-[1.6]">
              <h3>Checkpoint summary</h3>
              <p>
                Download a summary of checkpoint activity for event
                reporting.
              </p>
              <span className="p-[3px_7px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-sm text-muted-foreground text-[0.65rem] [font-weight:750] tracking-[0.07em]">CSV FILE</span>
            </div>

            <a
              className="button inline-flex items-center no-underline inline-flex items-center justify-center gap-[10px]

          min-h-[44px] [flex-shrink:0] p-[0px_15px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-control [background:var(--card)] text-fg [font-family:inherit]

          text-[0.82rem] [font-weight:650] no-underline [transition:border-color_150ms]

          max-[600.001px]:[grid-column:1_/_-1] max-[600.001px]:w-full max-[600.001px]:box-border

          [&:hover]:border-accent [&_span]:text-[1rem]"
              href={link('summary.csv')}
              aria-label="Download checkpoint summary CSV"
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>
        </div>
      </section>
    </div>
    </>
  );
}
