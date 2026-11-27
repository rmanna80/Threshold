import { randomUUID } from 'node:crypto';
import { setIdGenerator } from '@threshold/core';

setIdGenerator(() => randomUUID());
