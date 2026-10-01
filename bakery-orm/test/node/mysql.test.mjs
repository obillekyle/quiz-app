import { describe } from 'node:test'
import { scenario } from './scenario.mjs'

const url = process.env.MYSQL_TEST_URL
if (url) process.env.DB_URL = url
describe('mysql', { skip: url ? false : 'MYSQL_TEST_URL is not set' }, () => scenario('mysql'))
