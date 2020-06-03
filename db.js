'use strict';

const { Pool } = require('pg');

const where = conditions => {
  let clause = '';
  const args = [];
  let i = 1;
  for (const key in conditions) {
    let value = conditions[key];
    let condition;
    if (typeof value === 'number') {
      condition = `${key} = $${i}`;
    } else if (typeof value === 'string') {
      if (value.startsWith('>=')) {
        condition = `${key} >= $${i}`;
        value = value.substring(2);
      } else if (value.startsWith('<=')) {
        condition = `${key} <= $${i}`;
        value = value.substring(2);
      } else if (value.startsWith('<>')) {
        condition = `${key} <> $${i}`;
        value = value.substring(2);
      } else if (value.startsWith('>')) {
        condition = `${key} > $${i}`;
        value = value.substring(1);
      } else if (value.startsWith('<')) {
        condition = `${key} < $${i}`;
        value = value.substring(1);
      } else if (value.includes('*') || value.includes('?')) {
        value = value.replace(/\*/g, '%').replace(/\?/g, '_');
        condition = `${key} LIKE $${i}`;
      } else {
        condition = `${key} = $${i}`;
      }
    }
    i++;
    args.push(value);
    clause = clause ? `${clause} AND ${condition}` : condition;
  }
  return { clause, args };
};

const MODE_ROWS = 0;
const MODE_VALUE = 1;
const MODE_ROW = 2;
const MODE_COL = 3;
const MODE_COUNT = 4;

class Cursor {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.cols = null;
    this.rows = null;
    this.rowCount = 0;
    this.ready = false;
    this.mode = MODE_ROWS;
    this.whereClause = undefined;
    this.columns = ['*'];
    this.args = [];
    this.orderBy = undefined;
    this.right = undefined;
    this.right_key = undefined;
    this.left_key = null;
    this.type_join = null;
    this.isCreate = false;
    this.columnIndex = null;
    this.unique = null;
  }

  resolve(result) {
    const { rows, fields, rowCount } = result;
    this.rows = rows;
    this.cols = fields;
    this.rowCount = rowCount;
  }

  where(conditions) {
    const { clause, args } = where(conditions);
    this.whereClause = clause;
    this.args = args;
    return this;
  }

  fields(list) {
    this.columns = list;
    return this;
  }

  value() {
    this.mode = MODE_VALUE;
    return this;
  }

  row() {
    this.mode = MODE_ROW;
    return this;
  }

  join(right, left_key, right_key, type_join) {
    this.type_join = type_join;
    this.right = right;
    this.left_key = left_key;
    this.right_key = right_key;
    return this;
  }

  col(name) {
    this.mode = MODE_COL;
    this.columnName = name;
    return this;
  }

  count() {
    this.mode = MODE_COUNT;
    return this;
  }

  order(name) {
    this.orderBy = name;
    return this;
  }

  createIndex(column, unique = false ) {
    this.unique = unique;
    this.columnIndex = column;
    this.isCreate = true;
    return this;
  }


  then(callback) {
    // TODO: store callback to pool
    const { mode, table, columns, args } = this;
    const { whereClause, orderBy, columnName } = this;
    const { right, left_key, right_key, type_join } = this;
    const { isCreate, unique, columnIndex } = this;
    const fields = columns.join(', ');
    let sql;
    console.log(isCreate);
    if (isCreate) {
      sql = `CREATE ${(unique) ? 'UNIQUE' : ''} INDEX ON ${table}(${columnIndex})`;
    } else {
      sql = `SELECT ${fields} FROM ${table}`;
      if (right && left_key && right_key && type_join) sql += ` ${type_join} JOIN ${right} ON ${table}.${left_key}=${right}.${right_key}`;
      if (whereClause) sql += ` WHERE ${whereClause}`;
      if (orderBy) sql += ` ORDER BY ${orderBy}`;
    }
    console.log(sql);
    
    this.database.query(sql, args,  (err, res) => {
      this.resolve(res);
      const { rows, cols } = this;
      if (mode === MODE_VALUE) {
        const col = cols[0];
        const row = rows[0];
        callback(row[col.name]);
      } else if (mode === MODE_ROW) {
        callback(rows[0]);
      } else if (mode === MODE_COL) {
        const col = [];
        for (const row of rows) {
          col.push(row[columnName]);
        }
        callback(col);
      } else if (mode === MODE_COUNT) {
        callback(this.rowCount);
      } else {
        callback(rows);
      }
    });
    return this;
  }
}

class Database {
  constructor(config, logger) {
    this.pool = new Pool(config);
    this.config = config;
    this.logger = logger;
  }

  query(sql, values, callback) {
    if (typeof values === 'function') {
      callback = values;
      values = [];
    }
    const startTime = new Date().getTime();
    console.log({ sql, values });
    this.pool.query(sql, values, (err, res) => {
      const endTime = new Date().getTime();
      const executionTime = endTime - startTime;
      console.log(`Execution time: ${executionTime}`);
      if (callback) callback(err, res);
    });
  }

  select(table) {
    return new Cursor(this, table);
  }

  close() {
    this.pool.end();
  }
}

module.exports = {
  open: (config, logger) => new Database(config, logger),
};