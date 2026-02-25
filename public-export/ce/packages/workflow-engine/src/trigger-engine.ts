import {
  TriggerAction,
  TriggerCondition,
  TriggerContext,
  TriggerDefinition,
  TriggerExecutionResult,
} from './types.js';

export interface TriggerActionExecutor {
  execute(action: TriggerAction, context: TriggerContext): Promise<unknown>;
  schedule(action: TriggerAction, context: TriggerContext, delayMs: number): Promise<void>;
}

export class TriggerEngine {
  constructor(private readonly executor: TriggerActionExecutor) {}

  evaluateCondition(condition: TriggerCondition, context: TriggerContext): boolean {
    const fieldValue = this.getFieldValue(context, condition.field);
    switch (condition.operator) {
      case '==':
        return fieldValue === condition.value;
      case '!=':
        return fieldValue !== condition.value;
      case '>':
        return typeof fieldValue === 'number' && typeof condition.value === 'number'
          ? fieldValue > condition.value
          : false;
      case '<':
        return typeof fieldValue === 'number' && typeof condition.value === 'number'
          ? fieldValue < condition.value
          : false;
      case '>=':
        return typeof fieldValue === 'number' && typeof condition.value === 'number'
          ? fieldValue >= condition.value
          : false;
      case '<=':
        return typeof fieldValue === 'number' && typeof condition.value === 'number'
          ? fieldValue <= condition.value
          : false;
      case 'IN':
        return Array.isArray(condition.value) ? condition.value.includes(fieldValue) : false;
      case 'NOT IN':
        return Array.isArray(condition.value) ? !condition.value.includes(fieldValue) : false;
      default:
        return false;
    }
  }

  evaluateTrigger(trigger: TriggerDefinition, context: TriggerContext): boolean {
    if (!trigger.enabled) {
      return false;
    }

    return trigger.conditions.every((condition) => this.evaluateCondition(condition, context));
  }

  async executeTrigger(
    trigger: TriggerDefinition,
    context: TriggerContext,
  ): Promise<TriggerExecutionResult> {
    if (!this.evaluateTrigger(trigger, context)) {
      return {
        executed: false,
        reason: 'Conditions not met',
        results: [],
      };
    }

    const sortedActions = [...trigger.actions];
    const results: TriggerExecutionResult['results'] = [];

    for (const action of sortedActions) {
      try {
        if (action.delayMs !== undefined && action.delayMs > 0) {
          await this.executor.schedule(action, context, action.delayMs);
          results.push({
            action: action.skill,
            status: 'scheduled',
          });
          continue;
        }

        const result = await this.executor.execute(action, context);
        results.push({
          action: action.skill,
          status: 'success',
          result,
        });
      } catch (error) {
        results.push({
          action: action.skill,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (!action.retryOnFailure) {
          break;
        }
      }
    }

    return {
      executed: true,
      results,
    };
  }

  private getFieldValue(context: TriggerContext, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (typeof value !== 'object' || value === null) {
        return undefined;
      }

      const objectValue = value as Record<string, unknown>;
      value = objectValue[part];
    }

    return value;
  }
}