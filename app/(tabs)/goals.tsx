import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Button from '../../components/Button';
import Card from '../../components/Card';
import HeldInChip from '../../components/goals/HeldInChip';
import HeldInRows from '../../components/goals/HeldInRows';
import DateField from '../../components/DateField';
import FormInput from '../../components/FormInput';
import InlineError from '../../components/InlineError';
import OverlayModal from '../../components/OverlayModal';
import SegmentedControl, { SegmentOption } from '../../components/SegmentedControl';
import SheetModal from '../../components/SheetModal';
import { useAccountsState, useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { AccountGoal } from '../../types/accounts';
import { AccountsError } from '../../utils/accounts/errors';
import { getGoalAmounts, getReserve } from '../../utils/accounts/reserve';
import { alertLedgerError } from '../../utils/alerts';
import { toLocalDateKey } from '../../utils/dates';
import { getProjectedCompletionDate } from '../../utils/currency';
import { accountName, formatDateKey, formatETB } from '../../utils/format';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';
import { GOAL_MISSING_MESSAGE, resolveGoalFocus } from '../../utils/notificationList';

type MoveMode = 'add' | 'withdraw';
type GoalTab = 'active' | 'completed';

interface MoveState {
  goalId: string;
  mode: MoveMode;
}

// Messages of the checks the sheets always had; they were native pop-ups, they are now shown in place.
const GOAL_FORM_MESSAGE = 'Enter a goal name and a valid target amount.';
const GOAL_ACCOUNT_MESSAGE = 'Choose the account this goal is held in.';
const MOVE_AMOUNT_MESSAGE = 'Enter an amount greater than zero.';

export default function GoalsScreen() {
  const { colors } = useTheme();
  const { goals, accounts, allocations, addGoal, updateGoal, deleteGoal, moveGoal: moveGoalToAccount, addToGoal, withdrawFromGoal } = useFinanceStore();
  const ledger = useAccountsState();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<GoalTab>('active');
  // Opened from a goal notification (route param `goal`): scroll to that goal and light it up for a moment, or say it is gone.
  const params = useLocalSearchParams<{ goal?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const cardY = useRef<Record<string, number>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [handledGoal, setHandledGoal] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [name, setNameState] = useState('');
  const [targetAmount, setTargetAmountState] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  // The account a goal is held in (an ETB account). Chosen when the goal is created; it can only change while the goal holds nothing.
  const [heldInId, setHeldInIdState] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [menuGoalId, setMenuGoalId] = useState<string | null>(null);

  // "Move money" sheet: add = set money aside for the goal inside its account, withdraw = set it free again. Neither moves money between
  // accounts or creates a transaction.
  const [move, setMove] = useState<MoveState | null>(null);
  const [moveAmount, setMoveAmountState] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // Every figure on this screen is a sum over the goal allocations (V2 Part C): a goal holds what was set aside for it, minus what was
  // freed or used. ETB accounts that goals can be held in (a USD account cannot hold one).
  const goalAmounts = useMemo(() => getGoalAmounts(allocations), [allocations]);
  const heldBy = (goal: AccountGoal) => Math.max(goalAmounts[goal.id] ?? 0, 0);
  // The route param, once per tap. State is adjusted while rendering (guarded, so it settles at once) rather than inside an effect; the effect
  // below only does the side effects (scrolling, clearing the param, the timer).
  const focusParam = Array.isArray(params.goal) ? params.goal[0] : params.goal;
  if (focusParam && focusParam !== handledGoal) {
    setHandledGoal(focusParam);
    const focus = resolveGoalFocus(focusParam, goals);
    if (focus.kind === 'missing') {
      setShowMissing(true);
    } else if (focus.kind === 'goal') {
      setShowMissing(false);
      setTab(focus.tab);
      setHighlightId(focus.goalId);
    }
  } else if (!focusParam && handledGoal !== '') {
    setHandledGoal(''); // the param was cleared: the next tap is a new one
  }

  useEffect(() => {
    if (!focusParam) {
      return;
    }
    const focus = resolveGoalFocus(focusParam, goals);
    if (focus.kind === 'goal') {
      // Wait a moment so the tab has drawn the card and reported where it is, then scroll to it and let the highlight fade.
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }
      highlightTimer.current = setTimeout(() => {
        const y = cardY.current[focus.goalId];
        if (y !== undefined) {
          scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
        }
        highlightTimer.current = setTimeout(() => setHighlightId(null), 2600);
      }, 120);
    }
    // The param has done its job; clearing it lets the same notification be tapped again.
    router.setParams({ goal: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam]);

  useEffect(
    () => () => {
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }
    },
    [],
  );

  const goalAccounts = useMemo(() => accounts.filter((account) => !account.archived && account.currency === 'ETB'), [accounts]);

  const activeGoals = useMemo(() => goals.filter((goal) => goal.status !== 'completed'), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.status === 'completed'), [goals]);
  const totalInGoals = Object.values(goalAmounts).reduce((sum, value) => sum + value, 0);

  const tabOptions: SegmentOption<GoalTab>[] = [
    { key: 'active', label: `Active (${activeGoals.length})` },
    { key: 'completed', label: `Completed (${completedGoals.length})` },
  ];

  const moveGoal = move ? goals.find((goal) => goal.id === move.goalId) : undefined;
  const moveGoalHeld = moveGoal ? heldBy(moveGoal) : 0;
  const numericMoveAmount = Number(moveAmount);
  const hasValidMoveAmount = Number.isFinite(numericMoveAmount) && numericMoveAmount > 0;
  // Live hint only; the ledger is what actually blocks an overdraw.
  const freeIn = (accountId: string) => getReserve(ledger, accountId).freeToSpend;
  const moveFree = moveGoal ? getReserve(ledger, moveGoal.heldInAccountId).freeToSpend : 0;
  const moveShortfall = (() => {
    if (!move || !moveGoal || !hasValidMoveAmount) {
      return null;
    }
    if (move.mode === 'add') {
      return numericMoveAmount > moveFree ? `Only ${formatETB(moveFree)} is free to set aside in ${accountName(moveGoal.heldInAccountId, accounts)}.` : null;
    }
    return numericMoveAmount > moveGoalHeld ? `The ${moveGoal.name} goal only holds ${formatETB(moveGoalHeld)}.` : null;
  })();

  // Any edit clears the message it was about.
  const setName = (value: string) => {
    setGoalError(null);
    setNameState(value);
  };
  const setTargetAmount = (value: string) => {
    setGoalError(null);
    setTargetAmountState(value);
  };
  const setMoveAmount = (value: string) => {
    setMoveError(null);
    setMoveAmountState(value);
  };
  const setHeldInId = (value: string) => {
    setGoalError(null);
    setHeldInIdState(value);
  };

  const resetGoalForm = () => {
    setNameState('');
    setTargetAmountState('');
    setDeadline(null);
    setHeldInIdState(goalAccounts[0]?.id ?? null);
    setGoalError(null);
  };

  const openCreateGoal = () => {
    resetGoalForm();
    setEditingGoalId(null);
    setIsCreateOpen(true);
  };

  const openEditGoal = (goal: AccountGoal) => {
    setEditingGoalId(goal.id);
    setNameState(goal.name);
    setTargetAmountState(String(goal.targetAmount));
    setDeadline(goal.deadline);
    setHeldInIdState(goal.heldInAccountId);
    setGoalError(null);
    setIsCreateOpen(false);
  };

  const closeGoalModal = () => {
    setIsCreateOpen(false);
    setEditingGoalId(null);
    resetGoalForm();
  };

  const onSaveGoal = async () => {
    const numericTarget = Number(targetAmount);
    if (!name.trim() || !Number.isFinite(numericTarget) || numericTarget <= 0) {
      setGoalError(GOAL_FORM_MESSAGE);
      return;
    }

    if (!heldInId) {
      setGoalError(GOAL_ACCOUNT_MESSAGE);
      return;
    }

    try {
      if (editingGoalId) {
        await updateGoal(editingGoalId, { name: name.trim(), targetAmount: numericTarget, deadline });
        const current = goals.find((goal) => goal.id === editingGoalId);
        if (current && current.heldInAccountId !== heldInId) {
          // Only allowed while the goal holds nothing (the ledger says so if it does).
          await moveGoalToAccount(editingGoalId, heldInId);
        }
      } else {
        await addGoal({ name: name.trim(), targetAmount: numericTarget, deadline, heldInAccountId: heldInId });
      }
      closeGoalModal();
    } catch (error) {
      if (error instanceof AccountsError) {
        setGoalError(error.message);
      } else {
        throw error;
      }
    }
  };

  const openMove = (goal: AccountGoal, mode: MoveMode) => {
    setMove({ goalId: goal.id, mode });
    setMoveAmountState('');
    setMoveError(null);
  };

  const closeMove = () => {
    setMove(null);
    setMoveAmountState('');
    setMoveError(null);
  };

  const onConfirmMove = async () => {
    if (!move || !moveGoal) {
      return;
    }
    if (!hasValidMoveAmount) {
      setMoveError(MOVE_AMOUNT_MESSAGE);
      return;
    }

    setIsMoving(true);
    setMoveError(null);
    try {
      if (move.mode === 'add') {
        await addToGoal(moveGoal.id, numericMoveAmount);
      } else {
        await withdrawFromGoal(moveGoal.id, numericMoveAmount);
      }
      closeMove();
    } catch (error) {
      // Blocked (not enough free money in the account, or more than the goal holds): keep the sheet open to adjust, with the reason shown in place.
      if (error instanceof AccountsError) {
        setMoveError(error.message);
      } else {
        throw error;
      }
    } finally {
      setIsMoving(false);
    }
  };

  const onDeleteGoal = (goal: AccountGoal) => {
    Alert.alert('Delete goal', `Delete "${goal.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Blocked while the goal still holds money - it must be withdrawn first. (There is no sheet open here, so this stays a
          // native alert.)
          deleteGoal(goal.id).catch(alertLedgerError);
        },
      },
    ]);
  };

  const menuGoal = menuGoalId ? goals.find((goal) => goal.id === menuGoalId) : undefined;
  const editingGoalHeld = editingGoalId ? Math.max(goalAmounts[editingGoalId] ?? 0, 0) : 0;

  const renderActions = (goal: AccountGoal, showAdd: boolean) => {
    const held = heldBy(goal);
    return (
      <View style={styles.actionRow}>
        {showAdd && (
          <Pressable
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: colors.streakFill, borderColor: colors.primary },
              pressed && styles.pressed,
            ]}
            onPress={() => openMove(goal, 'add')}
            accessibilityRole="button"
            accessibilityLabel={`Add money to ${goal.name}`}
          >
            <Ionicons name="add-circle-outline" size={16} color={colors.primaryText} />
            <AppText style={[styles.actionText, { color: colors.text }]} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
              Add money
            </AppText>
          </Pressable>
        )}
        {held > 0 && (
          <Pressable
            style={({ pressed }) => [styles.action, { borderColor: colors.inputBorder }, pressed && styles.pressed]}
            onPress={() => openMove(goal, 'withdraw')}
            accessibilityRole="button"
            accessibilityLabel={`Withdraw money from ${goal.name}`}
          >
            <Ionicons name="arrow-down-circle-outline" size={16} color={colors.textMuted} />
            <AppText style={[styles.actionText, { color: colors.textMuted }]} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
              Withdraw
            </AppText>
          </Pressable>
        )}
      </View>
    );
  };

  const dotsButton = (goal: AccountGoal) => (
    <Pressable
      style={({ pressed }) => [styles.dotsButton, pressed && styles.pressed]}
      onPress={() => setMenuGoalId(goal.id)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${goal.name} options`}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Savings Goals" />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {showMissing ? (
          // Tapped a notification about a goal that has since been deleted.
          <View style={[styles.note, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <AppText style={[styles.noteText, { color: colors.text }]}>{GOAL_MISSING_MESSAGE}</AppText>
            <Pressable onPress={() => setShowMissing(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {/* A clear, labelled button at the top of the list - nothing like the round raised + in the tab bar. */}
        <Button title="New goal" icon="add" onPress={openCreateGoal} accessibilityLabel="Create a new goal" />

        <SegmentedControl options={tabOptions} value={tab} onChange={setTab} />

        {goals.length > 0 && (
          <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <AppText style={[styles.noteText, { color: colors.textMuted }]}>
              {formatETB(totalInGoals)} is reserved for goals. It stays in the account that holds it, so your bank balance still matches. If you
              spend it, the goal shrinks to match.
            </AppText>
          </View>
        )}

        {tab === 'active' &&
          (activeGoals.length === 0 ? (
            <AppText style={[styles.emptyState, { color: colors.textMuted }]}>
              No active goals yet. Tap New goal to create your first savings goal.
            </AppText>
          ) : (
            activeGoals.map((goal) => {
              const held = heldBy(goal);
              const percent = goal.targetAmount > 0 ? Math.min((held / goal.targetAmount) * 100, 100) : 0;
              const projectedDate = getProjectedCompletionDate(goal, allocations);
              return (
                <Card
                  key={goal.id}
                  style={[styles.card, highlightId === goal.id && { borderColor: colors.primary, borderWidth: 2 }]}
                  onLayout={(event) => {
                    cardY.current[goal.id] = event.nativeEvent.layout.y;
                  }}
                >
                  <View style={styles.goalHeaderRow}>
                    <View style={[styles.disc, { backgroundColor: colors.goalsDisc }]}>
                      <Ionicons name="flag" size={18} color={colors.goalsGlyph} />
                    </View>
                    <AppText style={[styles.goalName, { color: colors.text }]} numberOfLines={1}>
                      {goal.name}
                    </AppText>
                    <AppText variant="number" style={[styles.percent, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {percent.toFixed(0)}%
                    </AppText>
                    {dotsButton(goal)}
                  </View>

                  <View
                    style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${goal.name}, ${percent.toFixed(0)} percent saved`}
                    accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
                  >
                    <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: colors.goalsBar }]} />
                  </View>

                  <AppText variant="number" style={[styles.goalText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatETB(held)} of {formatETB(goal.targetAmount)}
                  </AppText>
                  <HeldInChip account={accounts.find((account) => account.id === goal.heldInAccountId)} />
                  {goal.deadline && (
                    <View style={styles.metaRow}>
                      <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                      <AppText style={[styles.metaText, { color: colors.textMuted }]}>Deadline: {formatDateKey(goal.deadline)}</AppText>
                    </View>
                  )}
                  {projectedDate && (
                    <View style={styles.metaRow}>
                      <Ionicons name="trending-up-outline" size={14} color={colors.textMuted} />
                      <AppText style={[styles.metaText, { color: colors.textMuted }]}>
                        Projected completion: {formatDateKey(toLocalDateKey(projectedDate))}
                      </AppText>
                    </View>
                  )}

                  {renderActions(goal, true)}
                </Card>
              );
            })
          ))}

        {tab === 'completed' &&
          (completedGoals.length === 0 ? (
            <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No completed goals yet.</AppText>
          ) : (
            completedGoals.map((goal) => (
              <Card
                key={goal.id}
                style={[styles.card, highlightId === goal.id && { borderColor: colors.primary, borderWidth: 2 }]}
                onLayout={(event) => {
                    cardY.current[goal.id] = event.nativeEvent.layout.y;
                  }}
              >
                <View style={styles.goalHeaderRow}>
                  <View style={[styles.disc, { backgroundColor: colors.goalsDisc }]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.goalsGlyph} />
                  </View>
                  <View style={styles.completedInfo}>
                    <AppText style={[styles.goalName, { color: colors.text }]} numberOfLines={1}>
                      {goal.name}
                    </AppText>
                    <View style={styles.metaRow}>
                      <Ionicons name="checkmark" size={14} color={colors.textMuted} />
                      <AppText style={[styles.metaText, { color: colors.textMuted }]}>
                        Completed · {formatDateKey(goal.updatedAt.slice(0, 10))}
                      </AppText>
                    </View>
                  </View>
                  {dotsButton(goal)}
                </View>
                <AppText variant="number" style={[styles.goalText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatETB(heldBy(goal))} of {formatETB(goal.targetAmount)}
                </AppText>
                <HeldInChip account={accounts.find((account) => account.id === goal.heldInAccountId)} />
                {/* A finished goal still holds its money until it is withdrawn. */}
                {renderActions(goal, false)}
              </Card>
            ))
          ))}

        {goals.length > 0 ? (
          <View style={[styles.explainer, { backgroundColor: colors.surfaceMuted }]}>
            <AppText style={[styles.explainerText, { color: colors.text }]}>
              <AppText style={styles.explainerBold}>Add money</AppText> only reserves it inside the account that holds the goal, so no balance changes.{' '}
              <AppText style={styles.explainerBold}>Withdraw</AppText> frees it again.
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      {/* Create / edit goal */}
      <SheetModal visible={isCreateOpen || editingGoalId !== null} onClose={closeGoalModal}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          {editingGoalId ? 'Edit goal' : 'Create a new goal'}
        </AppText>
        <FormInput value={name} onChangeText={setName} placeholder="Goal name" accessibilityLabel="Goal name" invalid={goalError !== null && !name.trim()} />
        <FormInput
          value={targetAmount}
          onChangeText={setTargetAmount}
          placeholder="Target amount (ETB)"
          keyboardType="decimal-pad"
          accessibilityLabel="Target amount in ETB"
          invalid={goalError !== null && !(Number(targetAmount) > 0)}
        />
        <DateField label="Deadline" value={deadline} onChange={setDeadline} />
        <AppText style={[styles.fieldLabel, { color: colors.textMuted }]}>Held in</AppText>
        {goalAccounts.length === 0 ? (
          <>
            <AppText style={[styles.metaText, { color: colors.textMuted }]}>
              A goal is held in an ETB account (a goal cannot be held in a foreign-currency account). Add one first.
            </AppText>
            <Button
              title="Add an account"
              variant="secondary"
              onPress={() => {
                closeGoalModal();
                router.push('/accounts');
              }}
            />
          </>
        ) : editingGoalId && editingGoalHeld > 0 ? (
          <AppText style={[styles.metaText, { color: colors.textMuted }]}>
            {accountName(heldInId, accounts)}. A goal can only move to another account while it holds nothing: withdraw it first.
          </AppText>
        ) : (
          <>
            <HeldInRows accounts={goalAccounts} value={heldInId} onChange={setHeldInId} freeToSpend={freeIn} />
            <AppText style={[styles.metaText, { color: colors.textMuted }]}>
              Money you add stays in this account; it is only set aside for the goal, and it cannot be more than the free to spend shown for that account.
            </AppText>
          </>
        )}
        {goalError !== null && <InlineError message={goalError} />}
        <Button title={editingGoalId ? 'Save changes' : 'Create goal'} onPress={() => void onSaveGoal()} />
      </SheetModal>

      {/* Set money aside for a goal, or free it again (no ledger entry either way) */}
      <SheetModal visible={move !== null} onClose={closeMove}>
        {move && moveGoal && (
          <>
            <AppText variant="title" style={styles.sheetTitle} numberOfLines={1} accessibilityRole="header">
              {move.mode === 'add' ? `Add money to ${moveGoal.name}` : `Withdraw from ${moveGoal.name}`}
            </AppText>
            <View style={[styles.sheetNote, { backgroundColor: colors.surfaceMuted }]}>
              <AppText style={[styles.sheetNoteText, { color: colors.text }]}>
                {move.mode === 'add'
                  ? `This only sets money aside inside ${accountName(moveGoal.heldInAccountId, accounts)}. Nothing is spent or moved, and the account balance stays the same.`
                  : `This only frees money that was set aside. Nothing leaves ${accountName(moveGoal.heldInAccountId, accounts)}; its balance stays the same.`}
              </AppText>
            </View>
            <AppText style={[styles.metaText, { color: colors.textMuted }]}>
              {moveGoal.name} holds {formatETB(moveGoalHeld)} of {formatETB(moveGoal.targetAmount)}.
            </AppText>
            {move.mode === 'add' ? (
              <View style={styles.freeRow}>
                <AppText style={[styles.metaText, { color: colors.textMuted }]}>Free to spend in {accountName(moveGoal.heldInAccountId, accounts)}</AppText>
                <AppText variant="number" style={[styles.freeAmount, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatETB(moveFree)}
                </AppText>
              </View>
            ) : null}

            <FormInput
              style={styles.amountInput}
              value={moveAmount}
              onChangeText={setMoveAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              autoFocus
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="Amount"
              invalid={moveError !== null && !hasValidMoveAmount}
            />
            <View style={styles.quickRow}>
              {move.mode === 'add' && moveGoal.targetAmount - moveGoalHeld > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.quickChip,
                    { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setMoveAmount(String(Math.round((moveGoal.targetAmount - moveGoalHeld) * 100) / 100))}
                  accessibilityRole="button"
                >
                  <AppText style={[styles.quickChipText, { color: colors.text }]}>
                    Remaining {formatETB(moveGoal.targetAmount - moveGoalHeld)}
                  </AppText>
                </Pressable>
              )}
              {move.mode === 'withdraw' && moveGoalHeld > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.quickChip,
                    { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setMoveAmount(String(moveGoalHeld))}
                  accessibilityRole="button"
                >
                  <AppText style={[styles.quickChipText, { color: colors.text }]}>All {formatETB(moveGoalHeld)}</AppText>
                </Pressable>
              )}
            </View>

            {moveShortfall && moveError === null && <InlineError message={moveShortfall} />}
            {moveError !== null && <InlineError message={moveError} />}

            <Button
              title={move.mode === 'add' ? 'Add money' : 'Withdraw'}
              onPress={() => void onConfirmMove()}
              disabled={isMoving}
            />
          </>
        )}
      </SheetModal>

      {/* Three-dot menu */}
      <OverlayModal visible={menuGoal !== undefined} animationType="fade" onRequestClose={() => setMenuGoalId(null)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: colors.scrim }]} onPress={() => setMenuGoalId(null)}>
          <View
            style={[
              styles.menuSheet,
              { paddingBottom: 20 + insets.bottom, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Pressable
              style={({ pressed }) => [styles.menuOption, pressed && { backgroundColor: colors.surfaceMuted }]}
              onPress={() => {
                const goal = menuGoal;
                setMenuGoalId(null);
                if (goal) openEditGoal(goal);
              }}
              accessibilityRole="button"
              accessibilityLabel="Edit goal"
            >
              <Ionicons name="create-outline" size={20} color={colors.text} />
              <AppText style={[styles.menuOptionText, { color: colors.text }]}>Edit goal</AppText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuOption, pressed && { backgroundColor: colors.surfaceMuted }]}
              onPress={() => {
                const goal = menuGoal;
                setMenuGoalId(null);
                if (goal) onDeleteGoal(goal);
              }}
              accessibilityRole="button"
              accessibilityLabel="Delete goal"
            >
              <Ionicons name="trash-outline" size={20} color={colors.expense} />
              <AppText style={[styles.menuOptionText, { color: colors.expense }]}>Delete goal</AppText>
            </Pressable>
          </View>
        </Pressable>
      </OverlayModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 12,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 16,
  },
  card: {
    padding: 14,
    gap: 8,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
  },
  completedInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  percent: {
    fontSize: 15,
    fontWeight: '700',
  },
  dotsButton: {
    padding: 2,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  goalText: {
    fontSize: 16,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    flexShrink: 1,
    fontSize: 13,
  },
  // Quiet secondary actions. Wraps onto a second line instead of pushing the second pill out of the card at large font sizes.
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  explainer: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  explainerText: {
    fontSize: 13,
    lineHeight: 20,
  },
  explainerBold: {
    fontWeight: '700',
  },
  sheetNote: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetNoteText: {
    fontSize: 13,
    lineHeight: 19,
  },
  freeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  freeAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  sheetTitle: {
    fontSize: 18,
  },
  amountInput: {
    fontSize: 26,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  menuOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
