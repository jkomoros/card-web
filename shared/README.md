# Card-Web Shared Library

This directory contains shared code that is used by both the web app and Firebase functions. 

The purpose of this shared library is to avoid code duplication and ensure consistency between the two environments.

## Current shared components

- **env-constants.ts**: Environment variable names shared between web app and cloud functions
- **card-fields.ts**: Shared card field constants and property names

## How to use

Import directly from the shared directory in both the web app and functions:

```typescript
// In web app
import { SOME_CONSTANT } from '../shared/some-module.js';

// In functions
import { SOME_CONSTANT } from '../../shared/some-module.js';
```

## Building

The shared library needs to be built before both the web app and functions.
The main build scripts have been modified to build this directory first.