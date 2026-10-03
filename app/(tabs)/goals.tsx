import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DateField from '../../components/DateField';
import SheetModal from '../../components/SheetModal';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useFinanceStore } from '../../store/finance';
import { Account, Goal } from '../../types';
import { alertLedgerError } from '../../utils/alerts';
import { getBalances } from '../../utils/balances';
import { getProjectedCompletionDate } from '../../utils/currency';
import { formatDateKey, formatETB } from '../../utils/format';
import { toLocalDateKey } from '../../utils/dates';

type MoveMode = 'add' | 'withdraw';

interface MoveState {
  goalId: string;
  mode: MoveMode;
}

const ACCOUNT_LABELS: Record<Account, string> = {
  available: 'Available',
  saved: 'Saved',
};

export default function GoalsScreen() {
  const { goals, transactions, addGoal, updateGoal, deleteGoal, contributeToGoal, withdrawFromGoal } =
    useFinanceStore();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [menuGoalId, setMenuGoalId] = useState<string | null>(null);

  // "Move money" sheet: add = Available|Saved -> Goal, withdraw = Goal -> Available|Saved.
  const [move, setMove] = useState<MoveState | null>(null);
  const [moveAmount, setMoveAmount] = useState('');
  const [moveAccount, setMoveAccount] = useState<Account>('available');
  const [isMoving, setIsMoving] = useState(false);

  // Every figure on this screen comes from the ledger (V2 Part C); a goal holds only what was
  // transferred into it, minus what was transferred out.
  const balances = useMemo(() => getBalances(transactions), [transactions]);
  const heldBy = (goal: Goal) => Math.max(balances.goals[goal.id] ?? 0, 0);

  const activeGoals = useMemo(() => goals.filter((goal) => goal.status !== 'completed'), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.status === 'completed'), [goals]);
  const totalInGoals = Object.values(balances.goals).reduce((sum, value) => sum + value, 0);

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

  const resetGoalForm = () => {
    setName('');
    setTargetAmount('');
    setDeadline(null);
  };

  const openCreateGoal = () => {
    resetGoalForm();
    setEditingGoalId(null);
    setIsCreateOpen(true);
  };

  const openEditGoal = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setDeadline(goal.deadline);
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
      Alert.alert('Enter a goal name and a valid target amount.');
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
    setMoveAmount('');
    setMoveAccount('available');
  };

  const closeMove = () => {
    setMove(null);
    setMoveAmount('');
  };

  const onConfirmMove = async () => {
    if (!move || !moveGoal) {
      return;
    }
    if (!hasValidMoveAmount) {
      Alert.alert('Enter an amount greater than zero.');
      return;
    }

    setIsMoving(true);
    try {
      if (move.mode === 'add') {
        await contributeToGoal(moveGoal.id, numericMoveAmount, moveAccount);
      } else {
        await withdrawFromGoal(moveGoal.id, numericMoveAmount, moveAccount);
      }
      closeMove();
    } catch (error) {
      // Blocked by the ledger (not enough money in the source): keep the sheet open to adjust.
      alertLedgerError(error);
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
          // Blocked while the goal still holds money - it must be moved out first.
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
            style={({ pressed }) => [styles.addAction, pressed && styles.pressed]}
            onPress={() => openMove(goal, 'add')}
            accessibilityRole="button"
            accessibilityLabel={`Add money to ${goal.name}`}
          >
            <Ionicons name="add-circle-outline" size={16} color={colors.orange} />
            <Text style={styles.addActionText}>Add money</Text>
          </Pressable>
        )}
        {held > 0 && (
          <Pressable
            style={({ pressed }) => [styles.withdrawAction, pressed && styles.pressed]}
            onPress={() => openMove(goal, 'withdraw')}
            accessibilityRole="button"
            accessibilityLabel={`Withdraw money from ${goal.name}`}
          >
            <Ionicons name="arrow-down-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.withdrawActionText}>Withdraw</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Savings Goals</Text>
        <Pressable style={styles.addButton} onPress={openCreateGoal} accessibilityRole="button" accessibilityLabel="Create a goal">
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, tab === 'active' && styles.tabSelected]} onPress={() => setTab('active')}>
            <Text style={[styles.tabText, tab === 'active' && styles.tabTextSelected]}>Active ({activeGoals.length})</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'completed' && styles.tabSelected]} onPress={() => setTab('completed')}>
            <Text style={[styles.tabText, tab === 'completed' && styles.tabTextSelected]}>
              Completed ({completedGoals.length})
            </Text>
          </Pressable>
        </View>

        {goals.length > 0 && (
          <Text style={styles.metaText}>
            {formatETB(totalInGoals)} is set aside in goals. It is still part of your Total Balance — withdraw it to
            Available or Saved to spend it.
          </Text>
        )}

        {tab === 'active' &&
          (activeGoals.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyState}>No active goals yet — tap + to create your first savings goal.</Text>
            </View>
          ) : (
            activeGoals.map((goal) => {
              const held = heldBy(goal);
              const percent = goal.targetAmount > 0 ? Math.min((held / goal.targetAmount) * 100, 100) : 0;
              const projectedDate = getProjectedCompletionDate(goal, transactions);
              return (
                <View key={goal.id} style={styles.card}>
                  <View style={styles.goalHeaderRow}>
                    <View style={styles.goalIconCircle}>
                      <Ionicons name="flag" size={18} color={colors.orange} />
                    </View>
                    <Text style={styles.goalName} numberOfLines={1}>
                      {goal.name}
                    </Text>
                    <Text style={styles.percentBadge}>{percent.toFixed(0)}%</Text>
                    <Pressable
                      style={styles.dotsButton}
                      onPress={() => setMenuGoalId(goal.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${goal.name} options`}
                    >
                      <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>

                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${percent}%` }]} />
                  </View>

                  <Text style={styles.goalText}>
                    {formatETB(held)} of {formatETB(goal.targetAmount)}
                  </Text>
                  {goal.deadline && <Text style={styles.metaText}>Deadline: {formatDateKey(goal.deadline)}</Text>}
                  {projectedDate && (
                    <Text style={styles.metaText}>Projected completion: {formatDateKey(toLocalDateKey(projectedDate))}</Text>
                  )}

                  {renderActions(goal, true)}
                </View>
              );
            })
          ))}

        {tab === 'completed' &&
          (completedGoals.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyState}>No completed goals yet.</Text>
            </View>
          ) : (
            completedGoals.map((goal) => (
              <View key={goal.id} style={styles.card}>
                <View style={styles.goalHeaderRow}>
                  <View style={[styles.goalIconCircle, styles.doneIconCircle]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.olive} />
                  </View>
                  <View style={styles.completedInfo}>
                    <Text style={styles.goalName} numberOfLines={1}>
                      {goal.name}
                    </Text>
                    <Text style={styles.metaText}>Completed · {formatDateKey(goal.updatedAt.slice(0, 10))}</Text>
                  </View>
                  <Pressable
                    style={styles.dotsButton}
                    onPress={() => setMenuGoalId(goal.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${goal.name} options`}
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.goalText}>
                  {formatETB(heldBy(goal))} of {formatETB(goal.targetAmount)}
                </Text>
                {/* A finished goal still holds its money until it is moved out. */}
                {renderActions(goal, false)}
              </View>
            ))
          ))}
      </ScrollView>

      {/* Create / edit goal */}
      <SheetModal visible={isCreateOpen || editingGoalId !== null} onClose={closeGoalModal}>
        <Text style={styles.sectionTitle}>{editingGoalId ? 'Edit goal' : 'Create a new goal'}</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Goal name" />
        <TextInput
          style={styles.input}
          value={targetAmount}
          onChangeText={setTargetAmount}
          placeholder="Target amount (ETB)"
          keyboardType="decimal-pad"
        />
        <DateField label="Deadline" value={deadline} onChange={setDeadline} />
        <Pressable style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]} onPress={() => void onSaveGoal()}>
          <Text style={styles.confirmButtonText}>{editingGoalId ? 'Save changes' : 'Create goal'}</Text>
        </Pressable>
      </SheetModal>

      {/* Move money: Available|Saved -> Goal, or Goal -> Available|Saved */}
      <SheetModal visible={move !== null} onClose={closeMove}>
        {move && moveGoal && (
          <>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {move.mode === 'add' ? `Add money to ${moveGoal.name}` : `Withdraw from ${moveGoal.name}`}
            </Text>
            <Text style={styles.metaText}>
              Holds {formatETB(moveGoalHeld)} of {formatETB(moveGoal.targetAmount)}. This moves money you already
              have; your Total Balance does not change.
            </Text>

            <TextInput
              style={styles.amountInput}
              value={moveAmount}
              onChangeText={setMoveAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.quickRow}>
              {move.mode === 'add' && moveGoal.targetAmount - moveGoalHeld > 0 && (
                <Pressable
                  style={styles.quickChip}
                  onPress={() => setMoveAmount(String(Math.round((moveGoal.targetAmount - moveGoalHeld) * 100) / 100))}
                >
                  <Text style={styles.quickChipText}>Remaining {formatETB(moveGoal.targetAmount - moveGoalHeld)}</Text>
                </Pressable>
              )}
              {move.mode === 'withdraw' && moveGoalHeld > 0 && (
                <Pressable style={styles.quickChip} onPress={() => setMoveAmount(String(moveGoalHeld))}>
                  <Text style={styles.quickChipText}>All {formatETB(moveGoalHeld)}</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.fieldLabel}>{move.mode === 'add' ? 'From' : 'To'}</Text>
            {(['available', 'saved'] as const).map((account) => {
              const selected = moveAccount === account;
              return (
                <Pressable
                  key={account}
                  style={[styles.accountRow, selected && styles.accountRowSelected]}
                  onPress={() => setMoveAccount(account)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.orange : colors.textSecondary}
                  />
                  <Text style={styles.accountName}>{ACCOUNT_LABELS[account]}</Text>
                  <Text style={styles.accountBalance}>{formatETB(balances[account])}</Text>
                </Pressable>
              );
            })}

            {moveShortfall && <Text style={styles.warningText}>{moveShortfall}</Text>}

            <Pressable
              style={({ pressed }) => [styles.confirmButton, (pressed || isMoving) && styles.pressed]}
              onPress={() => void onConfirmMove()}
              disabled={isMoving}
            >
              <Text style={styles.confirmButtonText}>{move.mode === 'add' ? 'Add money' : 'Withdraw'}</Text>
            </Pressable>
          </>
        )}
      </SheetModal>

      {/* Three-dot menu */}
      <Modal visible={menuGoal !== undefined} transparent animationType="fade" onRequestClose={() => setMenuGoalId(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuGoalId(null)}>
          <View style={[styles.menuSheet, { paddingBottom: spacing.xl + insets.bottom }]}>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                const goal = menuGoal;
                setMenuGoalId(null);
                if (goal) openEditGoal(goal);
              }}
            >
              <Ionicons name="create-outline" size={20} color={colors.navy} />
              <Text style={styles.menuOptionText}>Edit goal</Text>
            </Pressable>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                const goal = menuGoal;
                setMenuGoalId(null);
                if (goal) onDeleteGoal(goal);
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.red} />
              <Text style={[styles.menuOptionText, styles.deleteText]}>Delete goal</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 24,
    color: colors.navy,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.button - 2,
  },
  tabSelected: {
    backgroundColor: colors.navy,
  },
  tabText: {
    color: colors.navy,
    fontWeight: '600',
  },
  tabTextSelected: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  goalIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.orangeLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneIconCircle: {
    backgroundColor: colors.oliveLight,
  },
  goalName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  completedInfo: {
    flex: 1,
  },
  percentBadge: {
    ...typography.helper,
    fontWeight: '800',
    color: colors.navy,
  },
  dotsButton: {
    padding: 2,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.statusIncome,
    borderRadius: radius.pill,
  },
  goalText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  metaText: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  // Quiet secondary actions - a soft tint and an outline, not a filled CTA.
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.orangeLight,
  },
  addActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.navy,
  },
  withdrawAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#DDE0E8',
  },
  withdrawActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.navy,
  },
  amountInput: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 26,
    fontWeight: '800',
    color: colors.navy,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  quickChipText: {
    ...typography.helper,
    fontWeight: '700',
    color: colors.navy,
  },
  fieldLabel: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: '#E8EAF0',
  },
  accountRowSelected: {
    borderColor: colors.orange,
    backgroundColor: colors.orangeLight,
  },
  accountName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },
  accountBalance: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  warningText: {
    ...typography.helper,
    color: colors.red,
  },
  confirmButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  menuOptionText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.navy,
  },
  deleteText: {
    color: colors.red,
  },
});
