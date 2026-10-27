import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import OpeningCard from '../components/accounts/OpeningCard';
import PairCard from '../components/sms/PairCard';
import SuggestionCard from '../components/sms/SuggestionCard';
import { useAccountsState, useFinanceStore } from '../store/finance';
import { useSmsStore } from '../store/sms';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { maskAmount } from '../utils/format';
import { formatAmount } from '../utils/accounts/money';
import { SERVICE_LABEL } from '../utils/sms/accountMatch';
import { BulkSummary, bulkSummary } from '../utils/sms/bulkRun';
import { buildChains, feeProposals, gapNotes } from '../utils/sms/chain';
import { defaultCtx } from '../utils/accounts/context';
import { openingCards } from '../utils/sms/opening';
import { pairedSuggestionIds, searchPairs, selectPairs } from '../utils/sms/pairing';
import { checkPair } from '../utils/sms/pairSave';
import { checkSuggestion, cleanOrder } from '../utils/sms/saveSuggestion';

// The review queue: one card per pending message, oldest first. Nothing is saved until the owner says so.
export default function SmsReviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const state = useAccountsState();
  const categories = useFinanceStore((store) => store.categories);
  const suggestions = useSmsStore((store) => store.suggestions);
  const editSuggestion = useSmsStore((store) => store.editSuggestion);
  const ignoreSuggestion = useSmsStore((store) => store.ignoreSuggestion);
  const restoreSuggestion = useSmsStore((store) => store.restoreSuggestion);
  const linkAccount = useSmsStore((store) => store.linkAccount);
  const confirmSuggestion = useSmsStore((store) => store.confirmSuggestion);
  const saveAllClean = useSmsStore((store) => store.saveAllClean);
  const rejectedPairs = useSmsStore((store) => store.rejectedPairs);
  const ownNameRows = useSmsStore((store) => store.ownNames);
  const ownNames = useMemo(() => ownNameRows.map((row) => row.name), [ownNameRows]);
  const acceptPair = useSmsStore((store) => store.acceptPair);
  const rejectPair = useSmsStore((store) => store.rejectPair);
  const bulkProgress = useSmsStore((store) => store.bulkProgress);
  const openingOptions = useSmsStore((store) => store.openingOptions);
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  // What the last "Save all that are clean" did: always something to read, and it stays until it is dismissed or the next run.
  const [bulkResult, setBulkResult] = useState<BulkSummary | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [skippedOpen, setSkippedOpen] = useState(false);
  // The fee typed on each pair card, by pair: what the card's effect line shows AND what Accept saves.
  const [feeByPair, setFeeByPair] = useState<Record<string, number>>({});

  // Possible transfers between the owner's own accounts. Each message is in at most one pair card; while it is, it has no card of its own.
  const search = useMemo(() => searchPairs(state, suggestions, rejectedPairs, ownNames), [state, suggestions, rejectedPairs, ownNames]);
  const candidates = search.candidates;
  const pairs = useMemo(() => selectPairs(candidates), [candidates]);
  const inAnyPair = useMemo(() => pairedSuggestionIds(candidates), [candidates]);
  const shownAsPair = useMemo(() => pairedSuggestionIds(pairs), [pairs]);
  const pairChecks = useMemo(
    () => pairs.map((pair) => ({ pair, check: checkPair(state, pair.key, suggestions, undefined, { fee: feeByPair[pair.key] ?? null, ownNames }) })),
    [pairs, state, suggestions, feeByPair, ownNames],
  );
  // The balance chain: a note when a message does not follow from the one before it, and a fee proposal where the balance dropped by more than
  // the amount of a message that printed no charges. Both are only shown; neither blocks or changes anything.
  const chains = useMemo(() => buildChains(suggestions, state.accounts), [suggestions, state.accounts]);
  const proposals = useMemo(() => feeProposals(chains), [chains]);
  const notes = useMemo(() => gapNotes(chains, new Set(proposals.keys())), [chains, proposals]);
  // Quiet "Opening balance" cards: only for accounts that have a message waiting here, so the page stays about what is waiting.
  const openings = useMemo(() => {
    const waitingAccounts = new Set(suggestions.filter((item) => item.status === 'pending' && item.accountId !== null).map((item) => item.accountId as string));
    const mask = (text: string) => maskAmount(text, isBalanceHidden);
    return [...openingCards(state, suggestions, { ...openingOptions(mask), ctx: defaultCtx })].filter(([accountId]) => waitingAccounts.has(accountId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, suggestions, rejectedPairs, isBalanceHidden]);
  const pending = useMemo(() => cleanOrder(suggestions).filter((item) => !shownAsPair.has(item.id)), [suggestions, shownAsPair]);
  const skipped = useMemo(() => suggestions.filter((item) => item.status === 'ignored'), [suggestions]);
  // A message that could be one side of a transfer needs a decision first, so "Save all that are clean" leaves it alone.
  const cleanCount = useMemo(() => pending.filter((item) => !inAnyPair.has(item.id) && !notes.has(item.id) && checkSuggestion(state, item).clean).length, [pending, state, inAnyPair, notes]);

  const labelOf = (id: string): string => {
    const item = suggestions.find((candidate) => candidate.id === id);
    if (!item) return 'A message';
    const who = item.counterpartyName ?? item.counterpartyBank ?? SERVICE_LABEL[item.service];
    return `${who} · ${item.direction === 'out' ? 'out' : 'in'} ETB ${formatAmount(item.amount)} · ${item.date}`;
  };

  // The screen never leaves this page on its own and never goes quiet: while it runs it shows "Saving 3 of 12", and when it ends it says what
  // was saved and, for every message that was not, why.
  const onSaveAll = async () => {
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const result = await saveAllClean();
      setBulkResult(bulkSummary(result, labelOf));
    } catch (error) {
      setBulkResult({ headline: `Something went wrong while saving (${error instanceof Error ? error.message : 'unknown error'}). Anything not saved is still waiting here.`, lines: [], stayOnScreen: true });
    } finally {
      setBulkBusy(false);
    }
  };

  // While it runs only the progress is drawn: nothing else on the page is recomputed or re-rendered once per message.
  if (bulkProgress !== null) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <AppHeader title="Review SMS" />
        <View style={styles.container}>
          <Card style={styles.empty} accessibilityLiveRegion="polite" accessibilityLabel={`Saving ${bulkProgress.done} of ${bulkProgress.total}`}>
            <AppText variant="title" style={styles.emptyTitle}>
              Saving {bulkProgress.done} of {bulkProgress.total}…
            </AppText>
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View style={[styles.fill, { backgroundColor: colors.primary, width: `${bulkProgress.total === 0 ? 0 : Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }]} />
            </View>
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>Please keep this screen open. Your messages are being saved one by one.</AppText>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Review SMS" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {bulkResult !== null ? (
          <Card style={styles.result} accessibilityLiveRegion="polite">
            <AppText style={[styles.resultHead, { color: colors.text }]}>{bulkResult.headline}</AppText>
            {bulkResult.lines.map((line) => (
              <AppText key={line} style={[styles.resultLine, { color: colors.text }]}>
                • {line}
              </AppText>
            ))}
            {bulkResult.stayOnScreen ? <AppText style={[styles.resultLine, { color: colors.textMuted }]}>Those messages are still here. Fix them below, or skip them.</AppText> : null}
            <Button title="Dismiss" variant="secondary" onPress={() => setBulkResult(null)} />
          </Card>
        ) : null}

        {search.notices.length > 0 ? (
          <View style={styles.pairs}>
            {search.notices.map((notice) => (
              <Card key={notice.key} style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
                <AppText style={[styles.noticeText, { color: colors.text }]}>{notice.message}</AppText>
              </Card>
            ))}
          </View>
        ) : null}

        {openings.map(([accountId, proposal]) => (
          <OpeningCard
            key={accountId}
            proposal={proposal}
            accountName={state.accounts.find((account) => account.id === accountId)?.name ?? 'Account'}
            onType={() => router.push(`/account/${accountId}`)}
            inset
          />
        ))}

        {pairChecks.length > 0 ? (
          <View style={styles.pairs}>
            <AppText style={[styles.count, { color: colors.textMuted }]} accessibilityRole="header">
              Possible transfers ({pairChecks.length})
            </AppText>
            {pairChecks.map(({ pair, check }) => (
              <PairCard
                key={pair.key}
                candidate={pair}
                check={check}
                state={state}
                // Immediately, for the card's own effect line; Accept then saves exactly this fee. (Not written to the database per keystroke.)
                onFee={(value) => setFeeByPair((current) => ({ ...current, [pair.key]: value ?? 0 }))}
                onAccept={(mode, fee) => acceptPair(pair.key, mode, fee)}
                onReject={(reason) => rejectPair(pair.key, reason)}
              />
            ))}
          </View>
        ) : null}

        {pending.length > 0 ? (
          <>
            <View style={styles.headRow}>
              <AppText style={[styles.count, { color: colors.textMuted }]}>
                {pending.length} to review
              </AppText>
              <Button
                title={`Save all that are clean (${cleanCount})`}
                variant="secondary"
                disabled={cleanCount === 0 || bulkBusy}
                onPress={() => void onSaveAll()}
              />
            </View>
            {pending.map((item) => (
              <SuggestionCard
                key={item.id}
                suggestion={item}
                state={state}
                categories={categories}
                onChange={(patch) => editSuggestion(item.id, patch)}
                onLinkAccount={(accountId) => void linkAccount(item.id, accountId)}
                onSave={(remember) => confirmSuggestion(item.id, remember)}
                onIgnore={() => ignoreSuggestion(item.id)}
                chainNote={notes.get(item.id) ?? null}
                feeProposal={proposals.get(item.id) ?? null}
              />
            ))}
          </>
        ) : pairChecks.length === 0 ? (
          <Card style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={36} color={colors.textMuted} />
            <AppText variant="title" style={styles.emptyTitle}>
              Nothing to review
            </AppText>
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>
              {'Paste your bank or Telebirr messages and they will be waiting here for you to check.'}
            </AppText>
            <Button title="Import from SMS" onPress={() => router.replace('/import-sms')} />
          </Card>
        ) : null}

        {skipped.length > 0 ? (
          <View style={styles.skipped}>
            <Pressable
              onPress={() => setSkippedOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: skippedOpen }}
              accessibilityLabel={`Skipped, ${skipped.length}`}
              style={({ pressed }) => [styles.skippedHeader, pressed && { opacity: 0.6 }]}
            >
              <AppText style={[styles.skippedTitle, { color: colors.text }]}>Skipped ({skipped.length})</AppText>
              <Ionicons name={skippedOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {skippedOpen
              ? skipped.map((item) => (
                  <Card key={item.id} style={styles.skippedRow}>
                    <View style={styles.skippedText}>
                      <AppText style={[styles.skippedWho, { color: colors.text }]} numberOfLines={1}>
                        {item.counterpartyName ?? item.counterpartyBank ?? SERVICE_LABEL[item.service]}
                      </AppText>
                      <AppText style={[styles.skippedMeta, { color: colors.textMuted }]}>
                        {item.direction === 'out' ? 'Out' : 'In'} · ETB {formatAmount(item.amount)} · {item.date}
                      </AppText>
                    </View>
                    <Button title="Restore" variant="secondary" onPress={() => restoreSuggestion(item.id)} accessibilityLabel={`Restore ${item.counterpartyName ?? SERVICE_LABEL[item.service]}`} />
                  </Card>
                ))
              : null}
            {skippedOpen ? (
              <AppText style={[styles.skippedMeta, { color: colors.textMuted }]}>Skipped messages are not suggested again unless you restore them.</AppText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
    gap: 14,
  },
  pairs: {
    gap: 12,
  },
  result: {
    padding: 14,
    gap: 6,
  },
  resultHead: {
    fontSize: 15,
    fontWeight: '700',
  },
  resultLine: {
    fontSize: 13,
    lineHeight: 18,
  },
  track: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  headRow: {
    gap: 10,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
  },
  bulk: {
    fontSize: 14,
    fontWeight: '600',
  },
  skipped: {
    gap: 10,
  },
  skippedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  skippedTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  skippedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  skippedText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  skippedWho: {
    fontSize: 14,
    fontWeight: '600',
  },
  skippedMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  empty: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
