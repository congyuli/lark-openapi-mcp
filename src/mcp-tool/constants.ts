/**
 * Commonly used tools in MCP
 */

import { ToolName } from './tools';

export enum PresetName {
  /**
   * Default preset including IM, Bitable, Doc and Contact tools
   */
  LIGHT = 'preset.light',
  /**
   * Default preset including IM, Bitable, Doc and Contact tools
   */
  DEFAULT = 'preset.default',
  /**
   * IM related tools for chat and message operations
   */
  IM_DEFAULT = 'preset.im.default',
  /**
   * Base preset for base operations
   */
  BASE_DEFAULT = 'preset.base.default',
  /**
   * Base tools with batch operations
   */
  BASE_BATCH = 'preset.base.batch',
  /**
   * Document related tools for content and permission operations
   */
  DOC_DEFAULT = 'preset.doc.default',
  /**
   * Task management related tools
   */
  TASK_DEFAULT = 'preset.task.default',
  /**
   * Calendar event management tools
   */
  CALENDAR_DEFAULT = 'preset.calendar.default',

  STORE_HUB_DEFAULT = 'preset.storehub.default',
}

export const presetLightToolNames: ToolName[] = [
  'im.v1.message.list',
  'im.v1.message.create',
  'im.v1.chat.search',
  'contact.v3.user.batchGetId',
  'docx.v1.document.rawContent',
  'docx.builtin.import',
  'docx.builtin.search',
  'wiki.v2.space.getNode',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
];

export const presetContactToolNames: ToolName[] = ['contact.v3.user.batchGetId'];

export const presetImToolNames: ToolName[] = [
  'im.v1.chat.create',
  'im.v1.chat.list',
  'im.v1.chatMembers.get',
  'im.v1.message.create',
  'im.v1.message.list',
];

export const presetBaseCommonToolNames: ToolName[] = [
  'bitable.v1.app.create',
  'bitable.v1.appTable.create',
  'bitable.v1.appTable.list',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableRecord.search',
];

export const presetBaseToolNames: ToolName[] = [
  ...presetBaseCommonToolNames,
  'bitable.v1.appTableRecord.create',
  'bitable.v1.appTableRecord.update',
];

export const presetBaseRecordBatchToolNames: ToolName[] = [
  ...presetBaseCommonToolNames,
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
];

export const presetDocToolNames: ToolName[] = [
  'docx.v1.document.rawContent',
  'docx.builtin.import',
  'docx.builtin.search',
  'drive.v1.permissionMember.create',
  'wiki.v2.space.getNode',
  'wiki.v1.node.search',
];

export const presetTaskToolNames: ToolName[] = [
  'task.v2.task.create',
  'task.v2.task.patch',
  'task.v2.task.addMembers',
  'task.v2.task.addReminders',
];

export const presetCalendarToolNames: ToolName[] = [
  'calendar.v4.calendarEvent.create',
  'calendar.v4.calendarEvent.patch',
  'calendar.v4.calendarEvent.get',
  'calendar.v4.freebusy.list',
  'calendar.v4.calendar.primary',
];

export const defaultToolNames: ToolName[] = [
  ...presetImToolNames,
  ...presetBaseToolNames,
  ...presetDocToolNames,
  ...presetContactToolNames,
];

export const presetStoreHubToolNames: ToolName[] = [
  // base
  'bitable.v1.appTable.list',
  'bitable.v1.appTable.patch',
  'bitable.v1.app.create',
  'bitable.v1.app.get',
  'bitable.v1.appTable.create',
  'bitable.v1.appTable.delete',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableField.delete',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.update',
  'bitable.v1.appTable.patch',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchDelete',
  'bitable.v1.appTableRecord.batchGet',
  'bitable.v1.appTableRecord.batchUpdate',
  'bitable.v1.appTableRecord.create',
  'bitable.v1.appTableRecord.delete',
  'bitable.v1.appTableRecord.get',
  'bitable.v1.appTableRecord.list',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.update',
  'bitable.v1.appTableView.create',
  'bitable.v1.appTableView.delete',
  'bitable.v1.appTableView.get',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.patch',
  'bitable.v1.app.update',
  // calendar
  'calendar.v4.calendarEventAttendee.batchDelete',
  'calendar.v4.calendarEventAttendeeChatMember.list',
  'calendar.v4.calendarEventAttendee.create',
  'calendar.v4.calendarEventAttendee.list',
  'calendar.v4.calendarEvent.create',
  'calendar.v4.calendarEvent.delete',
  'calendar.v4.calendarEvent.get',
  'calendar.v4.calendarEvent.list',
  'calendar.v4.calendarEvent.patch',
  'calendar.v4.calendarEvent.search',
  'calendar.v4.calendar.get',
  'calendar.v4.calendar.list',
  'calendar.v4.calendar.patch',
  'calendar.v4.calendar.primary',
  'calendar.v4.freebusy.list',
  // docs
  'docs.v1.content.get',
  // docx
  'docx.v1.document.create',
  'docx.v1.document.get',
  'docx.v1.document.rawContent',
  'docx.builtin.search',
  // im
  'im.v1.chat.create',
  'im.v1.chat.delete',
  'im.v1.chat.search',
  'im.v1.message.create',
  'im.v1.message.delete',
  'im.v1.message.forward',
  'im.v1.message.get',
  'im.v1.message.list',
  // task
  'task.v2.comment.create',
  'task.v2.comment.delete',
  'task.v2.comment.get',
  'task.v2.comment.list',
  'task.v2.task.create',
  'task.v2.task.delete',
  'task.v2.task.get',
  'task.v2.task.list',
  'task.v2.task.patch',
  // wiki
  'wiki.v1.node.search',
];

export const presetTools: Record<PresetName, ToolName[]> = {
  [PresetName.LIGHT]: presetLightToolNames,
  [PresetName.DEFAULT]: defaultToolNames,
  [PresetName.IM_DEFAULT]: presetImToolNames,
  [PresetName.BASE_DEFAULT]: presetBaseToolNames,
  [PresetName.BASE_BATCH]: presetBaseRecordBatchToolNames,
  [PresetName.DOC_DEFAULT]: presetDocToolNames,
  [PresetName.TASK_DEFAULT]: presetTaskToolNames,
  [PresetName.CALENDAR_DEFAULT]: presetCalendarToolNames,
  [PresetName.STORE_HUB_DEFAULT]: presetStoreHubToolNames,
};
