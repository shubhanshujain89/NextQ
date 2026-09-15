/**
 * Base Repository Class
 * Provides common CRUD operations for all entities
 */

import { executeQuery, executeQueryOne, executeInsert, executeUpdate, executeTransaction } from '../connection.js';
import crypto from 'crypto';

export interface BaseEntity {
  id: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface QueryOptions {
  where?: Record<string, any>;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export abstract class BaseRepository<T extends BaseEntity> {
  protected abstract tableName: string;
  protected abstract primaryKey: string;

  /**
   * Convert database row to entity object (camelCase)
   */
  protected abstract mapRowToEntity(row: any): T;

  /**
   * Convert entity to database columns (snake_case)
   */
  protected abstract mapEntityToColumns(entity: Partial<T>): Record<string, any>;

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<T | null> {
    const sql = `SELECT * FROM \`${this.tableName}\` WHERE \`${this.primaryKey}\` = ? LIMIT 1`;
    const row = await executeQueryOne(sql, [id]);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Find all entities with optional filtering
   */
  async findAll(options: QueryOptions = {}): Promise<T[]> {
    let sql = `SELECT * FROM \`${this.tableName}\``;
    const params: any[] = [];

    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.keys(options.where).map((key) => {
        const value = options.where![key];
        if (value === null) return `\`${key}\` IS NULL`;
        params.push(value);
        return `\`${key}\` = ?`;
      });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (options.orderBy) {
      const direction = options.orderDirection === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY \`${options.orderBy}\` ${direction}`;
    }

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
      
      if (options.offset) {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const rows = await executeQuery(sql, params);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Find one entity by criteria
   */
  async findOne(where: Record<string, any>): Promise<T | null> {
    const results = await this.findAll({ where, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Create a new entity
   */
  async create(entity: Omit<T, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<T> {
    const columns = this.mapEntityToColumns(entity as Partial<T>);
    const id = entity.id || crypto.randomUUID();
    columns[this.primaryKey] = id;
    
    const columnNames = Object.keys(columns);
    const placeholders = columnNames.map(() => '?').join(', ');
    
    const sql = `INSERT INTO \`${this.tableName}\` (\`${columnNames.join('`, `')}\`) VALUES (${placeholders})`;
    
    await executeInsert(sql, Object.values(columns));
    
    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Failed to create entity in ${this.tableName}`);
    }
    
    return created;
  }

  /**
   * Update an entity by ID
   */
  async update(id: string, updates: Partial<T>): Promise<T | null> {
    const columns = this.mapEntityToColumns(updates);
    
    // Remove id and timestamps from updates
    delete columns.id;
    delete columns.created_at;
    delete columns.updated_at;
    
    if (Object.keys(columns).length === 0) {
      return this.findById(id);
    }
    
    const setClause = Object.keys(columns).map(key => `\`${key}\` = ?`).join(', ');
    const sql = `UPDATE \`${this.tableName}\` SET ${setClause} WHERE \`${this.primaryKey}\` = ?`;
    
    await executeUpdate(sql, [...Object.values(columns), id]);
    
    return this.findById(id);
  }

  /**
   * Delete an entity by ID
   */
  async delete(id: string): Promise<boolean> {
    const sql = `DELETE FROM \`${this.tableName}\` WHERE \`${this.primaryKey}\` = ?`;
    const result = await executeUpdate(sql, [id]);
    return result.affectedRows > 0;
  }

  /**
   * Count entities matching criteria
   */
  async count(where: Record<string, any> = {}): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM \`${this.tableName}\``;
    const params: any[] = [];

    if (Object.keys(where).length > 0) {
      const conditions = Object.keys(where).map(key => `\`${key}\` = ?`);
      sql += ` WHERE ${conditions.join(' AND ')}`;
      params.push(...Object.values(where));
    }

    const result = await executeQueryOne<{ count: number }>(sql, params);
    return result?.count || 0;
  }

  /**
   * Execute a raw query and map results
   */
  protected async query(sql: string, params: any[] = []): Promise<T[]> {
    const rows = await executeQuery(sql, params);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Execute a raw query and return single result
   */
  protected async queryOne(sql: string, params: any[] = []): Promise<T | null> {
    const row = await executeQueryOne(sql, params);
    return row ? this.mapRowToEntity(row) : null;
  }
}