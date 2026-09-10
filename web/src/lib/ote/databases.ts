/**
 * Writing the product's SQLite databases with sql.js.
 *
 * Both databases arrive as a template blob from the Blank.eote skeleton and are
 * returned modified - the schema, indexes and every other table stay exactly as
 * the product wrote them, because we only ever DELETE and INSERT rows.
 *
 * THE TRAP: quote every column name. "Order" and "Value" are SQL keywords, and
 * SQLite resolves an unknown double-quoted identifier as a STRING LITERAL rather
 * than erroring - so a typo becomes silent bad data instead of a crash. That is
 * how a deck once printed the word "SetPoint" in every setpoint cell.
 *
 * Ported from tools/make_project.py. Phase 1 of docs/BUILD_PLAN.md.
 */

import type { Database, SqlValue } from "sql.js";
import type { Alarm, Variable } from "./schema";

export const ALARM_GROUP = "AlarmGroup1";

const INITIAL: Record<string, string> = {
  BOOL: "false",
  REAL: "0",
  LREAL: "0",
  INT: "0",
  DINT: "0",
  UINT: "0",
  UDINT: "0",
  WORD: "0",
  DWORD: "0",
  STRING: "",
};

/** The product writes uppercase GUIDs into its databases. */
export const upperGuid = () => crypto.randomUUID().toUpperCase();

function columnsOf(db: Database, table: string): string[] {
  const result = db.exec(`pragma table_info('${table}')`);
  if (result.length === 0) throw new Error(`table ${table} not found`);
  const nameIndex = result[0].columns.indexOf("name");
  return result[0].values.map((row) => String(row[nameIndex]));
}

/**
 * Inserts one row, taking the column list from the table itself so we write
 * exactly the columns this version of the product defines - no more, no fewer.
 */
function insert(
  db: Database,
  table: string,
  columns: string[],
  row: Record<string, SqlValue>,
) {
  const quoted = columns.map((c) => `"${c}"`).join(",");
  const holes = columns.map(() => "?").join(",");
  db.run(
    `INSERT INTO ${table} (${quoted}) VALUES (${holes})`,
    columns.map((c) => (c in row ? row[c] : null)),
  );
}

export interface VariableIds {
  [name: string]: string;
}

/** Returns the modified database plus the UniqueId assigned to each tag. */
export function writeVariables(
  db: Database,
  variables: Variable[],
): VariableIds {
  db.run("DELETE FROM Variables");
  const columns = columnsOf(db, "Variables");
  const ids: VariableIds = {};

  variables.forEach((variable, index) => {
    const unique = upperGuid();
    ids[variable.Name] = unique;
    insert(db, "Variables", columns, {
      UniqueId: unique,
      Name: variable.Name,
      DataType: variable.DataType,
      Type: 1,
      IsArray: 0,
      Dimension: null,
      EnableVariableLength: 0,
      Size: 0,
      InitialValue: INITIAL[variable.DataType] ?? "0",
      InputRange: 0,
      Min: "",
      Max: "",
      Comments: variable.Comments,
      Value: null,
      Order: index + 1,
      ParentId: null,
      id: -1,
      FolderId: null,
      RootParentId: null,
      Retentive: 0,
      DataSharing: 0,
      StringEncode: 0,
      DeviceAddress: variable.DeviceAddress,
      BaseAddress: 0,
      IsSymbolVariable: 0,
    });
  });

  return ids;
}

export interface AlarmTarget {
  /** UniqueId of the alarm row - the binding target. */
  uid: string;
  /** e.g. "AlarmGroup1.Alarm4.Hi" */
  fullName: string;
  /** BoolAlarm for a bit alarm, LevelAlarm for a threshold. */
  subType: "BoolAlarm" | "LevelAlarm";
  /** the tag that triggers it */
  trigger: string;
}

const LEVEL_NAME = { 1: "HiHi", 2: "Hi", 3: "Lo", 4: "LoLo" } as const;

/**
 * Writes one alarm group and its alarms, returning what each alarm needs to be
 * bound to its trigger tag.
 */
export function writeAlarms(db: Database, alarms: Alarm[]): AlarmTarget[] {
  db.run("DELETE FROM Alarm");
  db.run("DELETE FROM AlarmGroup");

  const groupId = upperGuid();
  insert(db, "AlarmGroup", columnsOf(db, "AlarmGroup"), {
    UniqueId: groupId,
    Order: 1,
    Name: ALARM_GROUP,
    Id: 3,
    Parameter: 0,
    ActiveLabel: "Active",
    ACKLabel: "Ack",
    RTNLabel: "Return",
    HiHiLabel: "HiHi",
    HiLabel: "Hi",
    LoLabel: "Lo",
    LoLoLabel: "LoLo",
    Enable: 0,
    CurrentActiveCount: 0,
    CurrentRtnCount: 0,
    CurrentAckCount: 0,
    CurrentLogCount: 0,
    CumulativeActiveCount: 0,
    UNACKLabel: "UnAck",
    CurrentUnAckCount: 0,
    AlarmBehavior: 0,
  });

  const columns = columnsOf(db, "Alarm");
  const targets: AlarmTarget[] = [];

  alarms.forEach((alarm, index) => {
    const uid = upperGuid();
    const isBit = alarm.AlarmRecordType === 1;
    insert(db, "Alarm", columns, {
      UniqueId: uid,
      AlarmGroupId: groupId,
      AlarmType: alarm.AlarmType,
      AlarmRecordType: alarm.AlarmRecordType,
      Id: index + 1,
      IsOnTrigger: isBit ? 1 : 0,
      Message: alarm.Message,
      Order: index,
      Parameter: 0,
      Severity: alarm.Severity,
      Value: alarm.Value,
      Deadband: 0,
    });
    targets.push({
      uid,
      fullName: `${ALARM_GROUP}.Alarm${index + 1}.${LEVEL_NAME[alarm.AlarmType]}`,
      subType: isBit ? "BoolAlarm" : "LevelAlarm",
      trigger: alarm.Trigger,
    });
  });

  return targets;
}
