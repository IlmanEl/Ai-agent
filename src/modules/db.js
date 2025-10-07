import { createClient } from '@supabase/supabase-js';
import Joi from 'joi';

const schema = Joi.object({ url: Joi.string().required(), key: Joi.string().required() });

export function getDbClient(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: ' + error.message);

  const supabase = createClient(params.url, params.key);
  return {
    insert: async (table, data) => await supabase.from(table).insert(data),
    select: async (table, query) => await supabase.from(table).select(query),
  };
}