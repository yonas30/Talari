import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import DateField from '../components/DateField';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { alertLedgerError } from '../utils/alerts';
import { getGoalProgress, getProjectedCompletionDate } from '../utils/currency';
import { toLocalDateKey } from '../utils/dates';
import { Account } from '../types';

export default function GoalsScreen() {
  const { goals, transactions, addGoal, updateGoal, deleteGoal, contributeToGoal } = useFinanceStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  // Where a contribution is paid from. The fuller Available/Saved/Goal flow is Step 7.
  const [contributeFrom, setContributeFrom] = useState<Account>('available');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [contributionAmount, setContributionAmount] = useState<Record<string, string>>({});
  const [menuGoalId, setMenuGoalId] = useState<string | null>(null);

  const activeGoals = useMemo(() => goals.filter((goal) => goal.status !== 'completed'), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.status === 'completed'), [goals]);

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

  const openEditGoal = (goal: (typeof goals)[number]) => {
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

  const onCreateGoal = async () => {
    const numericTarget = Number(targetAmount);
    if (!name.trim() || !Number.isFinite(numericTarget) || numericTarget <= 0) {
      Alert.alert('Enter a goal name and a valid target amount.');
      return;
    }

    await addGoal({ name: name.trim(), targetAmount: numericTarget, deadline });
    closeGoalModal();
  };

  const onUpdateGoal = async () => {
    if (!editingGoalId) {
      return;
    }

    const numericTarget = Number(targetAmount);
    if (!name.trim() || !Number.isFinite(numericTarget) || numericTarget <= 0) {
      Alert.alert('Enter a goal name and a valid target amount.');
      return;
    }

    await updateGoal(editingGoalId, { name: name.trim(), targetAmount: numericTarget, deadline });
    closeGoalModal();
  };

  const onContribute = async (goalId: string) => {
    const amount = Number(contributionAmount[goalId]);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Enter a valid contribution amount.');
      return;
    }

    try {
      await contributeToGoal(goalId, amount, contributeFrom);
      setContributionAmount((prev) => ({ ...prev, [goalId]: '' }));
    } catch (error) {
      alertLedgerError(error);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Savings Goals</Text>
        <Pressable style={styles.addButton} onPress={openCreateGoal}>
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

        {tab === 'active' && (
          <>
            <View style={styles.motivationCard}>
              <Ionicons name="rocket" size={18} color={colors.olive} />
              <Text style={styles.motivationText}>Big goals turn small steps into big results.</Text>
            </View>

            {activeGoals.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyState}>No active goals yet — tap + to create your first savings goal.</Text>
              </View>
            ) : (
              activeGoals.map((goal) => {
                const { savedAmount, percent } = getGoalProgress(goal, transactions);
                const projectedDate = getProjectedCompletionDate(goal, transactions);
                const safePercent = Math.min(Math.max(percent, 0), 100);
                return (
                  <View key={goal.id} style={styles.card}>
                    <View style={styles.goalHeaderRow}>
                      <View style={styles.goalIconCircle}>
                        <Ionicons name="flag" size={18} color={colors.orange} />
                      </View>
                      <Text style={styles.goalName}>{goal.name}</Text>
                      <Text style={[styles.percentBadge, safePercent >= 100 && styles.completedPercent]}>{safePercent.toFixed(0)}%</Text>
                      <Pressable style={styles.dotsButton} onPress={() => setMenuGoalId(goal.id)} hitSlop={8}>
                        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                      </Pressable>
                    </View>

                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${safePercent}%` }]} />
                    </View>

                    <Text style={styles.goalText}>
                      ETB {savedAmount.toFixed(2)} saved · Target: ETB {goal.targetAmount.toFixed(2)}
                    </Text>
                    {goal.deadline && <Text style={styles.metaText}>Deadline: {goal.deadline}</Text>}
                    {projectedDate && (
                      <Text style={styles.metaText}>Projected completion: {toLocalDateKey(projectedDate)}</Text>
                    )}

                    <TextInput
                      style={styles.input}
                      value={contributionAmount[goal.id] ?? ''}
                      onChangeText={(value) => setContributionAmount((prev) => ({ ...prev, [goal.id]: value }))}
                      placeholder={`Add to ${goal.name} (ETB)`}
                      keyboardType="decimal-pad"
                    />
                    <View style={styles.segmented}>
                      {(['available', 'saved'] as const).map((option) => (
                        <AppButton
                          key={option}
                          title={`From ${option}`}
                          selected={contributeFrom === option}
                          onPress={() => setContributeFrom(option)}
                        />
                      ))}
                    </View>
                    <AppButton
                      title="Contribute"
                      variant="primary"
                      style={styles.mutedAction}
                      onPress={() => void onContribute(goal.id)}
                    />
                  </View>
                );
              })
            )}
          </>
        )}

        {tab === 'completed' &&
          (completedGoals.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyState}>No completed goals yet.</Text>
            </View>
          ) : (
            <View style={styles.completedSection}>
              <Text style={styles.completedHeading}>Completed goals</Text>
              {completedGoals.map((goal) => {
              const { savedAmount } = getGoalProgress(goal, transactions);
              return (
                <View key={goal.id} style={styles.completedRow}>
                  <View style={styles.goalIconCircle}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.olive} />
                  </View>
                  <View style={styles.completedInfo}>
                    <Text style={styles.goalName}>{goal.name}</Text>
                    <Text style={styles.metaText}>Completed</Text>
                  </View>
                  <View style={styles.completedActions}>
                    <Text style={styles.completedAmount}>
                      ETB {savedAmount.toFixed(2)}
                    </Text>
                      <Text style={styles.metaText}>{goal.updatedAt.slice(0, 10)}</Text>
                  </View>
                  <Pressable style={styles.dotsButton} onPress={() => setMenuGoalId(goal.id)} hitSlop={8}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>
              );
              })}
            </View>
          ))}
      </ScrollView>

      <Modal
        visible={isCreateOpen || editingGoalId !== null}
        transparent
        animationType="slide"
        onRequestClose={closeGoalModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeGoalModal}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
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
            <AppButton
              title={editingGoalId ? 'Save changes' : 'Create goal'}
              variant="primary"
              onPress={() => void (editingGoalId ? onUpdateGoal() : onCreateGoal())}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={menuGoalId !== null} transparent animationType="fade" onRequestClose={() => setMenuGoalId(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuGoalId(null)}>
          <View style={styles.menuSheet}>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                const goal = goals.find((item) => item.id === menuGoalId);
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
                const id = menuGoalId;
                setMenuGoalId(null);
                if (id) {
                  deleteGoal(id).catch(alertLedgerError);
                }
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
    paddingTop: 56,
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
    paddingVertical: 8,
    borderRadius: radius.button - 2,
  },
  tabSelected: {
    backgroundColor: colors.navy,
  },
  tabText: {
    fontWeight: '600',
    color: colors.navy,
  },
  tabTextSelected: {
    color: '#FFFFFF',
  },
  motivationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.oliveLight,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.navy,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  summaryLabel: {
    ...typography.helper,
    color: '#C6CCD8',
  },
  summaryValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  summaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: '#526078',
  },
  motivationText: {
    ...typography.helper,
    color: colors.navy,
    flex: 1,
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
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  goalIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.orangeLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  percentBadge: {
    fontWeight: '800',
    color: colors.statusIncome,
  },
  completedPercent: {
    color: colors.olive,
  },
  segmented: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.navy,
  },
  goalText: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.statusIncome,
    borderRadius: radius.pill,
  },
  metaText: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  completedSection: {
    gap: spacing.md,
  },
  completedHeading: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  completedInfo: {
    flex: 1,
  },
  completedActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  actionRowCompact: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  completedAmount: {
    fontWeight: '700',
    color: colors.navy,
  },
  dotsButton: {
    padding: spacing.xs,
  },
  mutedAction: {
    opacity: 0.65,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.35)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  menuOptionText: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '700',
  },
  deleteText: {
    color: colors.red,
  },
});
