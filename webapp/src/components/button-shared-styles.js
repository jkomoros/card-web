/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import { html } from '@polymer/lit-element';

export const ButtonSharedStyles = html`
<style>
  button {
    font-size: inherit;
    vertical-align: middle;
    color: var(--app-light-text-color);
    background: var(--app-dark-text-color);
    padding: 0.5em;
    box-shadow: 0 2px 2px #999;
    border: none;
    cursor: pointer;
    margin: 0.5em;
  }
  button.primary {
    background: var(--app-primary-color);
  }
  button.round {
    border-radius:50%;
  }
  button svg {
    fill: var(--app-light-text-color);
  }
  button:hover {
    box-shadow: 0 6px 6px #999;
    background: var(--app-secondary-color);
  }
  
  label {
    font-size:0.75em;
    color: var(--app-subtle-dark-text-color);
    font-weight:normal;
    margin:0;
    margin-top:1em;
  }
</style>
`;
