import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DateField from '../../components/DateField';
import FormInput from '../../components/FormInput';
import InlineError from '../../components/InlineError';
import OverlayModal from '../../components/OverlayModal';
import SegmentedControl, { SegmentOption } from '../../components/SegmentedControl';
import SheetModal from '../../components/SheetModal';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { Account, Goal } from '../../types';
import { alertLedgerError } from '../../utils/alerts';
import { getBalances, LedgerError } from '../../utils/balances';
import { toLocalDateKey } from '../../utils/dates';
import { getProjectedCompletionDate } from '../../utils/currency';
import { formatDateKey, formatETB } from '../../utils/format';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';

type MoveMode = 'add' | 'withdraw';
type GoalTab = 'active' | 'completed';

interface MoveState {
  goalId: string;
  mode: MoveMode;
}

const ACCOUNT_LABELS: Record<Account, string> = {
  available: 'Available',
  saved: 'Saved',
};

// Messages of the checks the sheets always had; they were native pop-ups, they are now shown in place.
const GOAL_FORM_MESSAGE = 'Enter a goal name and a valid target amount.';
const MOVE_AMOUNT_MESSAGE = 'Enter an amount greater than zero.';

export default function GoalsScreen() {
  const { colors } = useTheme();
  const { goals, transactions, addGoal, updateGoal, deleteGoal, contributeToGoal, withdrawFromGoal } =
    useFinanceStore();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<GoalTab>('active');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [name, setNameState] = useState('');
  const [targetAmount, setTargetAmountState] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [menuGoalId, setMenuGoalId] = useState<string | null>(null);

  // "Move money" sheet: add = Available|Saved -> Goal, withdraw = Goal -> Available|Saved.
  const [move, setMove] = useState<MoveState | null>(null);
  const [moveAmount, setMoveAmountState] = useState('');
  const [moveAccount, setMoveAccountState] = useState<Account>('available');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // Every figure on this screen comes from the ledger (V2 Part C); a goal holds only what was
  // transferred into it, minus what was transferred out.
  const balances = useMemo(() => getBalances(transactions), [transactions]);
  const heldBy = (goal: Goal) => Math.max(balances.goals[goal.id] ?? 0, 0);

  const activeGoals = useMemo(() => goals.filter((goal) => goal.status !== 'completed'), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.status === 'completed'), [goals]);
  const totalInGoals = Object.values(balances.goals).reduce((sum, value) => sum + value, 0);

  const tabOptions: SegmentOption<GoalTab>[] = [
    { key: 'active', label: `Active (${activeGoals.length})` },
    { key: 'completed', label: `Completed (${completedGoals.length})` },
  ];

  const moveGoal = move ? goals.find((goal) => goal.id === move.goalId) : undefined;
  const moveGoalHeld = moveGoal ? heldBy(moveGoal) : 0;
  const numericMoveAmount = Number(moveAmount);
  const hasValidMoveAmount = Number.isFinite(numericMoveAmount) && numericMoveAmount > 0;
  // Live hint only; the ledger is what actually blocks an overdraw.
  const moveShortfall = (() => {
    if (!move || !moveGoal || !hasValidMoveAmount) {
      return null;
    }
    const source = move.mode === 'add' ? balances[moveAccount] : moveGoalHeld;
    const sourceName = move.mode === 'add' ? ACCOUNT_LABELS[moveAccount] : `the ${moveGoal.name} goal`;
    return numericMoveAmount > source ? `${sourceName} only has ${formatETB(source)}.` : null;
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
  const setMoveAccount = (value: Account) => {
    setMoveError(null);
    setMoveAccountState(value);
  };

  const resetGoalForm = () => {
    setNameState('');
    setTargetAmountState('');
    setDeadline(null);
    setGoalError(null);
  };

  const openCreateGoal = () => {
    resetGoalForm();
    setEditingGoalId(null);
    setIsCreateOpen(true);
  };

  const openEditGoal = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setNameState(goal.name);
    setTargetAmountState(String(goal.targetAmount));
    setDeadline(goal.deadline);
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

    if (editingGoalId) {
      await updateGoal(editingGoalId, { name: name.trim(), targetAmount: numericTarget, deadline });
    } else {
      await addGoal({ name: name.trim(), targetAmount: numericTarget, deadline });
    }
    closeGoalModal();
  };

  const openMove = (goal: Goal, mode: MoveMode) => {
    setMove({ goalId: goal.id, mode });
    setMoveAmountState('');
    setMoveAccountState('available');
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
        await contributeToGoal(moveGoal.id, numericMoveAmount, moveAccount);
      } else {
        await withdrawFromGoal(moveGoal.id, numericMoveAmount, moveAccount);
      }
      closeMove();
    } catch (error) {
      // Blocked by the ledger (not enough money in the source): keep the sheet open to adjust, with the reason shown in place.
      if (error instanceof LedgerError) {
        setMoveError(error.message);
      } else {
        throw error;
      }
    } finally {
      setIsMoving(false);
    }
  };

  const onDeleteGoal = (goal: Goal) => {
    Alert.alert('Delete goal', `Delete "${goal.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Blocked while the goal still holds money - it must be moved out first. (There is no sheet open here, so this stays a
          // native alert.)
          deleteGoal(goal.id).catch(alertLedgerError);
        },
      },
    ]);
  };

  const menuGoal = menuGoalId ? goals.find((goal) => goal.id === menuGoalId) : undefined;

  const renderActions = (goal: Goal, showAdd: boolean) => {
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

  const dotsButton = (goal: Goal) => (
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

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* A clear, labelled button at the top of the list - nothing like the round raised + in the tab bar. */}
        <Button title="New goal" icon="add" onPress={openCreateGoal} accessibilityLabel="Create a new goal" />

        <SegmentedControl options={tabOptions} value={tab} onChange={setTab} />

        {goals.length > 0 && (
          <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <AppText style={[styles.noteText, { color: colors.textMuted }]}>
              {formatETB(totalInGoals)} is set aside in goals. It is still part of your Total Balance — withdraw it to
              Available or Saved to spend it.
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
              const projectedDate = getProjectedCompletionDate(goal, transactions);
              return (
                <Card key={goal.id} style={styles.card}>
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
              <Card key={goal.id} style={styles.card}>
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
                {/* A finished goal still holds its money until it is moved out. */}
                {renderActions(goal, false)}
              </Card>
            ))
          ))}
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
        {goalError !== null && <InlineError message={goalError} />}
        <Button title={editingGoalId ? 'Save changes' : 'Create goal'} onPress={() => void onSaveGoal()} />
      </SheetModal>

      {/* Move money: Available|Saved -> Goal, or Goal -> Available|Saved */}
      <SheetModal visible={move !== null} onClose={closeMove}>
        {move && moveGoal && (
          <>
            <AppText variant="title" style={styles.sheetTitle} numberOfLines={1} accessibilityRole="header">
              {move.mode === 'add' ? `Add money to ${moveGoal.name}` : `Withdraw from ${moveGoal.name}`}
            </AppText>
            <AppText style={[styles.metaText, { color: colors.textMuted }]}>
              Holds {formatETB(moveGoalHeld)} of {formatETB(moveGoal.targetAmount)}. This moves money you already
              have; your Total Balance does not change.
            </AppText>

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

            <AppText style={[styles.fieldLabel, { color: colors.textMuted }]}>{move.mode === 'add' ? 'From' : 'To'}</AppText>
            {(['available', 'saved'] as const).map((account) => {
              const selected = moveAccount === account;
              return (
                <Pressable
                  key={account}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { borderColor: selected ? colors.primary : colors.inputBorder },
                    selected && { backgroundColor: colors.streakFill },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setMoveAccount(account)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${ACCOUNT_LABELS[account]}, ${formatETB(balances[account])}`}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.primaryText : colors.textMuted}
                  />
                  <AppText style={[styles.accountName, { color: colors.text }]}>{ACCOUNT_LABELS[account]}</AppText>
                  <AppText
                    variant="number"
                    style={[styles.accountBalance, { color: selected ? colors.streakMuted : colors.textMuted }]}
                    maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
                    numberOfLines={1}
                  >
                    {formatETB(balances[account])}
                  </AppText>
                </Pressable>
              );
            })}

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
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  accountName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  accountBalance: {
    flexShrink: 0,
    fontSize: 13,
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
