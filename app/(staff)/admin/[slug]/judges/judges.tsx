'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { useCallback, useRef, useState } from 'react';
import type { Judge } from '@/lib/admin/judges';
import { formatUid, linkNotice, normalizeUid } from '@/lib/domain/badge';
import { useBadgeWrite } from '@/lib/scanner/badge-write';
import { useNfcReader, nfcSupported, type NfcTag } from '@/lib/scanner/nfc';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog, Modal } from '../dialog';
import { PageHeader } from '../page-header';

const MAX_CSV_BYTES = 2 * 1024 * 1024;
type Preview = { created: number; updated: number; unchanged: number; total: number; skipped: number; badLinkedin: number };
const judgesText = (n: number) => `${n} judge${n === 1 ? '' : 's'}`;
const BOX = 'grid gap-[14px] min-w-0 p-[20px] [border-width:1px] [border-style:solid] [border-color:var(--line)] rounded-lg [background:var(--card)] max-[600.001px]:p-[16px]';

// SPEC §11 Judges (v0.12.4, owner's request): import the judges, give each a LinkedIn, and link their badge, which then
// opens their name, "Judge", title and LinkedIn when tapped (§6.5). Badges link on Android Chrome only (Web NFC).
export function Judges({ slug, badgeOrigin }: { slug: string; badgeOrigin: string }) {
  const api = useApi();
  const [judges, setJudges] = useState<Judge[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ judges: Judge[] }>(adminUrl(slug, '/judges'));
    if (r.ok) setJudges(r.data.judges);
    else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);
  useLoad(load);

  // Import CSV: a dry run first, then Import.
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  async function runImport(text: string, dryRun: boolean) {
    setBusy(true);
    const r = await api<Preview>(adminUrl(slug, '/judges/import'), { method: 'POST', body: { csv: text, dryRun } });
    setBusy(false);
    return r;
  }
  async function choose(file: File | undefined) {
    setCsv(null);
    setPreview(null);
    setError(null);
    setMessage(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) return setError('That file is over 2 MB. Is it the right one?');
    const text = await file.text();
    const r = await runImport(text, true);
    if (!r.ok) return setError(r.status === 400 ? 'That file couldn’t be read as a CSV.' : errorText(r));
    setCsv(text);
    setPreview(r.data);
  }
  async function apply() {
    if (csv === null) return;
    const r = await runImport(csv, false);
    if (!r.ok) return setError(errorText(r));
    setCsv(null);
    setPreview(null);
    setInputKey((k) => k + 1);
    setMessage(`✓ Imported: ${r.data.created} new, ${r.data.updated} updated.`);
    await load();
  }

  // LinkedIn, edited per row.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  async function saveLinkedin(j: Judge) {
    const value = drafts[j.id] ?? j.linkedinUrl ?? '';
    const r = await api<{ linkedinUrl: string | null }>(adminUrl(slug, `/judges/${j.id}`), { method: 'PATCH', body: { linkedin: value } });
    if (!r.ok) return setMessage(`✕ ${errorText(r)}`);
    setDrafts((d) => {
      const rest = { ...d };
      delete rest[j.id];
      return rest;
    });
    setMessage(r.data.linkedinUrl ? `✓ LinkedIn saved for ${j.name}.` : `✓ LinkedIn cleared for ${j.name}.`);
    await load();
  }

  // Link badge: the same tap flow as the Participants page (write the profile link, then save the link).
  const badgeWrite = useBadgeWrite(badgeOrigin);
  const [target, setTarget] = useState<Judge | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const linking = useRef(false);
  async function link(tag: NfcTag, reader: NDEFReader, judge: Judge) {
    if (linking.current) return;
    const uid = normalizeUid(tag.serial);
    if (!uid) return setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    linking.current = true;
    setBadgeBusy(true);
    const write = await badgeWrite.write(tag, reader, uid);
    nfc.stop();
    const r = await api<{ code?: string }>(adminUrl(slug, `/judges/${judge.id}/badge`), { method: 'POST', body: { uid } });
    setTarget(null);
    setBadgeBusy(false);
    const code = r.ok ? r.data.code : r.status === 404 ? 'NOT_FOUND' : undefined;
    setMessage(code === 'BADGE_TAKEN' ? `✕ Badge ${formatUid(uid)} is a hacker’s badge. Use another badge for ${judge.name}.` : linkNotice(code, uid, judge.name, write).text);
    await load();
  }
  const nfc = useNfcReader({
    prefKey: 'station:judge-linker',
    defaultOn: false,
    autoStart: false,
    onTag: (tag, reader) => {
      badgeWrite.observe(tag.serial);
      if (target) void link(tag, reader, target);
    },
    onUnreadable: () => {
      if (target && !linking.current) setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    },
  });
  function startLink(j: Judge) {
    linking.current = false;
    setTarget(j);
    setBadgeError(null);
    if (nfc.state === 'off') void nfc.start(); // this click is the user gesture Chrome needs
  }
  function cancelLink() {
    badgeWrite.cancel();
    linking.current = true;
    nfc.stop();
    setTarget(null);
  }

  const [pending, setPending] = useState<{ kind: 'unlink' | 'delete'; judge: Judge } | null>(null);
  async function act(kind: 'unlink' | 'delete', j: Judge) {
    setPending(null);
    const r = await api<{ code?: string }>(adminUrl(slug, `/judges/${j.id}${kind === 'unlink' ? '/badge' : ''}`), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) return setMessage(`✕ ${errorText(r)}`);
    setMessage(kind === 'unlink' ? `✓ Badge unlinked from ${j.name}.` : `✓ ${j.name} removed from the judges.`);
    await load();
  }

  const canLink = nfcSupported();
  const writes = preview ? preview.created + preview.updated : 0;
  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px]">
      <PageHeader title="Judges" description="Import the judges, add their LinkedIn, and link their badge: tapping it opens their name, title and LinkedIn." />

      <section aria-labelledby="judges-import" className={`${BOX} max-w-[640px]`}>
        <div>
          <h2 id="judges-import" className="m-0 text-[1.08rem] tracking-[-0.02em]">Import CSV</h2>
          <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.88rem] leading-[1.65]">
            Download the judge tracker’s tab as CSV (File → Download → Comma-separated values). It reads Name, Title @ Company and LinkedIn, and only rows whose Status is Confirmed (or, from the judging sheet, Judging? is Yes). Judges are matched by name; nobody is removed.
          </p>
        </div>
        <Label className="grid gap-2 text-sm text-muted-foreground">
          CSV file
          <Input key={inputKey} className="w-full min-h-[44px]" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        </Label>
        {busy && !preview && <p role="status">Checking the file…</p>}
        {preview && (
          <p role="status" className="m-0">
            {judgesText(preview.total)} in the file: {preview.created} new, {preview.updated} updated, {preview.unchanged} unchanged
            {preview.skipped > 0 && `, ${preview.skipped} not confirmed (skipped)`}
            {preview.badLinkedin > 0 && `; ${preview.badLinkedin} LinkedIn link${preview.badLinkedin === 1 ? '' : 's'} weren’t profile links and are left blank`}.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" className="min-h-[44px] max-[480.001px]:flex-1" disabled={busy || writes === 0} onClick={() => void apply()}>
            {writes > 0 ? `Import ${writes}` : 'Import'}
          </Button>
        </div>
      </section>

      {error && <p role="alert" className="m-0 text-bad">✕ {error}</p>}
      <p role="status" className="m-0 min-h-[1.5em]">{message}</p>

      {judges && judges.length === 0 && <p className="copy text-muted-foreground">No judges yet. Import the tracker’s CSV above.</p>}
      {judges && judges.length > 0 && (
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judge</TableHead>
                <TableHead>LinkedIn</TableHead>
                <TableHead>Badge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {judges.map((j) => {
                const draft = drafts[j.id] ?? j.linkedinUrl ?? '';
                return (
                  <TableRow key={j.id}>
                    <TableCell className="align-top">
                      <div className="font-semibold">{j.name}</div>
                      {j.title && <div className="text-muted-foreground text-[13px]">{j.title}</div>}
                    </TableCell>
                    <TableCell className="align-top">
                      <form className="flex gap-[8px] items-center min-w-[260px]" onSubmit={(e) => { e.preventDefault(); void saveLinkedin(j); }}>
                        <Input aria-label={`LinkedIn for ${j.name}`} className="min-h-[44px] flex-1" placeholder="linkedin.com/in/…" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [j.id]: e.target.value }))} />
                        <Button type="submit" variant="outline" size="sm" disabled={draft === (j.linkedinUrl ?? '')}>Save</Button>
                      </form>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-[8px] items-center">
                        {j.badgeUid ? <span className="text-ok">✓ Linked</span> : <span className="text-muted-foreground">No badge</span>}
                        {j.badgeUid && (
                          // What anyone tapping the badge sees (§6.5).
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/profile/${j.badgeUid}`} target="_blank" rel="noopener" aria-label={`Open ${j.name}’s badge page`}>Open page ↗</a>
                          </Button>
                        )}
                        {canLink && (
                          <Button type="button" size="sm" variant="outline" disabled={badgeBusy} aria-label={`${j.badgeUid ? 'Replace' : 'Link'} badge for ${j.name}`} onClick={() => startLink(j)}>
                            {j.badgeUid ? 'Replace badge' : 'Link badge'}
                          </Button>
                        )}
                        {j.badgeUid && (
                          <Button type="button" size="sm" variant="ghost" aria-label={`Unlink badge for ${j.name}`} onClick={() => setPending({ kind: 'unlink', judge: j })}>Unlink</Button>
                        )}
                        <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${j.name}`} onClick={() => setPending({ kind: 'delete', judge: j })}>Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {target && (
        <Modal title="Link a badge" onCancel={cancelLink}>
          <p className="copy">Tap the badge to link it to {target.name}. Hold it on the phone until this closes.</p>
          <div aria-live="polite">
            {badgeBusy ? <p>Linking badge…</p> : (badgeError || nfc.error) && <p className="text-bad">{badgeError ?? nfc.error}</p>}
          </div>
          <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top:1px_solid_var(--line)]">
            {nfc.state === 'off' && !badgeBusy && <Button type="button" onClick={() => void nfc.start()}>Start badge reader</Button>}
            <Button type="button" variant="outline" onClick={cancelLink}>Cancel</Button>
          </div>
        </Modal>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'unlink' ? 'Unlink this badge?' : `Remove ${pending.judge.name}?`}
          body={<p>{pending.kind === 'unlink' ? `${pending.judge.name}’s badge stops opening their profile until it’s linked again.` : 'They leave the judge list, and their badge stops opening their profile. An import adds them back.'}</p>}
          confirmLabel={pending.kind === 'unlink' ? 'Unlink badge' : 'Remove'}
          danger
          onConfirm={() => void act(pending.kind, pending.judge)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
