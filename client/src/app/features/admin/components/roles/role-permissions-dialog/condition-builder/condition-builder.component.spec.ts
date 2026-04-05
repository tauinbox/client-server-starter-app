import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Component, viewChild } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../../../test-utils/transloco-testing';
import { ConditionBuilderComponent } from './condition-builder.component';
import { resetIdCounter } from './condition-builder.types';

// ─── Test host for input/output binding ────────────────────────────────────

@Component({
  imports: [ConditionBuilderComponent],
  template: `<app-condition-builder
    [value]="value"
    [readonly]="readonly"
    (valueChange)="onValueChange($event)"
  />`
})
class TestHostComponent {
  value = '';
  readonly = false;
  lastEmitted: string | undefined;
  builder = viewChild.required(ConditionBuilderComponent);

  onValueChange(val: string): void {
    this.lastEmitted = val;
  }
}

function setup(value = '', readonly = false) {
  TestBed.configureTestingModule({
    imports: [TestHostComponent, TranslocoTestingModuleWithLangs],
    providers: [provideNoopAnimations()]
  });

  const fixture = TestBed.createComponent(TestHostComponent);
  fixture.componentInstance.value = value;
  fixture.componentInstance.readonly = readonly;
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    component: fixture.componentInstance.builder()
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ConditionBuilderComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    resetIdCounter();
  });

  describe('initialization', () => {
    it('creates in visual mode with empty group when value is empty', () => {
      const { component } = setup('');

      expect(component.mode()).toBe('visual');
      expect(component.rootGroup().children).toHaveLength(0);
    });

    it('parses initial JSON value into visual model', () => {
      const { component } = setup('{"status": "active"}');

      expect(component.mode()).toBe('visual');
      expect(component.rootGroup().children).toHaveLength(1);
    });

    it('falls back to raw mode if JSON cannot be parsed', () => {
      const { component } = setup('not valid json');

      expect(component.mode()).toBe('raw');
    });

    it('parses complex query with $or', () => {
      const { component } = setup(
        '{"$or": [{"status": "active"}, {"role": "admin"}]}'
      );

      expect(component.rootGroup().logic).toBe('$or');
      expect(component.rootGroup().children).toHaveLength(2);
    });
  });

  describe('visual mode operations', () => {
    it('adds a rule to the root group', () => {
      const { component, host } = setup('');

      component.addRule(component.rootGroup());

      expect(component.rootGroup().children).toHaveLength(1);
      expect(component.rootGroup().children[0].type).toBe('rule');
      expect(host.lastEmitted).toBeDefined();
    });

    it('adds a nested group', () => {
      const { component } = setup('');

      component.addGroup(component.rootGroup());

      expect(component.rootGroup().children).toHaveLength(1);
      expect(component.rootGroup().children[0].type).toBe('group');
    });

    it('removes a child by index', () => {
      const { component } = setup('{"a": 1, "b": 2}');

      expect(component.rootGroup().children).toHaveLength(2);
      component.removeChild(component.rootGroup(), 0);
      expect(component.rootGroup().children).toHaveLength(1);
    });

    it('toggles group logic between $and and $or', () => {
      const { component } = setup('{"status": "active"}');

      expect(component.rootGroup().logic).toBe('$and');
      component.setGroupLogic(component.rootGroup(), '$or');
      expect(component.rootGroup().logic).toBe('$or');
    });

    it('updates a rule field', () => {
      const { component } = setup('{"status": "active"}');
      const child = component.rootGroup().children[0];

      component.setField(child, 'role');

      const rule = (
        component.rootGroup().children[0] as {
          type: 'rule';
          rule: { field: string };
        }
      ).rule;
      expect(rule.field).toBe('role');
    });

    it('updates a rule operator', () => {
      const { component } = setup('{"age": 18}');
      const child = component.rootGroup().children[0];

      component.setOperator(child, '$gt');

      const rule = (
        component.rootGroup().children[0] as {
          type: 'rule';
          rule: { operator: string };
        }
      ).rule;
      expect(rule.operator).toBe('$gt');
    });

    it('updates a rule value', () => {
      const { component } = setup('{"status": "active"}');
      const child = component.rootGroup().children[0];

      component.setValue(child, 'inactive');

      const rule = (
        component.rootGroup().children[0] as {
          type: 'rule';
          rule: { value: string };
        }
      ).rule;
      expect(rule.value).toBe('inactive');
    });

    it('sets $exists default value to "true"', () => {
      const { component } = setup('{"status": "active"}');
      const child = component.rootGroup().children[0];

      component.setOperator(child, '$exists');

      const rule = (
        component.rootGroup().children[0] as {
          type: 'rule';
          rule: { value: string };
        }
      ).rule;
      expect(rule.value).toBe('true');
    });
  });

  describe('mode toggle', () => {
    it('switches to raw mode and populates rawText', () => {
      const { component } = setup('{"status": "active"}');

      component.setMode('raw');

      expect(component.mode()).toBe('raw');
      expect(component.rawText()).toContain('status');
    });

    it('switches back to visual mode from valid raw JSON', () => {
      const { component } = setup('');

      component.setMode('raw');
      // Simulate typing valid JSON
      component.onRawInput({
        target: { value: '{"role": "admin"}' }
      } as unknown as Event);
      component.setMode('visual');

      expect(component.mode()).toBe('visual');
      expect(component.rootGroup().children).toHaveLength(1);
    });

    it('shows parse error when switching to visual with invalid JSON', () => {
      const { component } = setup('');

      component.setMode('raw');
      component.onRawInput({
        target: { value: 'invalid json' }
      } as unknown as Event);
      component.setMode('visual');

      expect(component.parseError()).toBe(true);
      expect(component.mode()).toBe('raw');
    });
  });

  describe('output emission', () => {
    it('emits empty string when all rules are removed', () => {
      const { component, host } = setup('{"status": "active"}');

      component.removeChild(component.rootGroup(), 0);

      expect(host.lastEmitted).toBe('');
    });

    it('emits valid JSON when a rule is added', () => {
      const { component, host } = setup('');

      component.addRule(component.rootGroup());
      component.setField(component.rootGroup().children[0], 'status');
      component.setValue(component.rootGroup().children[0], 'active');

      expect(host.lastEmitted).toBeDefined();
      const parsed = JSON.parse(host.lastEmitted!);
      expect(parsed).toEqual({ status: 'active' });
    });
  });

  describe('readonly mode', () => {
    it('renders without errors in readonly mode', () => {
      const { fixture } = setup('{"status": "active"}', true);

      expect(fixture.nativeElement.textContent).toBeTruthy();
    });

    it('has readonly input for the builder', () => {
      const { component } = setup('{"status": "active"}', true);

      expect(component.readonly()).toBe(true);
    });
  });

  describe('preview', () => {
    it('computes JSON preview from model', () => {
      const { component } = setup('{"status": "active"}');

      const preview = component.previewJson();
      const parsed = JSON.parse(preview);
      expect(parsed).toEqual({ status: 'active' });
    });

    it('preview updates when rule changes', () => {
      const { component } = setup('{"status": "active"}');
      const child = component.rootGroup().children[0];

      component.setValue(child, 'inactive');

      const parsed = JSON.parse(component.previewJson());
      expect(parsed).toEqual({ status: 'inactive' });
    });
  });
});
