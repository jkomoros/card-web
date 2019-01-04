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
    box-shadow: 0 2px 2px var(--shadow-color);
    border: none;
    cursor: pointer;
    margin: 0.5em;
    position: relative;
    overflow: hidden;
    transition: background-color var(--transition-fade), color var(--transition-fade), box-shadow var(--transition-fade);
  }
  button:disabled {
    background-color: var(--app-dark-text-color-light);
  }

  button:focus {
    outline:none;
  }

  button.primary {
    background: var(--app-primary-color);
  }
  button.primary.selected {
    background: var(--app-primary-color-light);
  }
  button.selected {
    background: var(--app-secondary-color-light);
  }
  button.round {
    border-radius:50%;
  }
  button svg {
    fill: var(--app-light-text-color);
  }
  button:hover {
    box-shadow: 0 6px 6px var(--shadow-color);
    background: var(--app-secondary-color);
  }

  button.small:disabled svg {
    fill: var(--app-dark-text-color-light);
  }

  button.small {
    background:transparent;
    padding: 0;
    margin:0;
    box-shadow: none;
  }

  button.small svg {
    fill: var(--app-dark-text-color);
    height:18px;
    width:18px;
  }

  button.small:hover svg {
    fill: var(--app-dark-text-color-light);
    box-shadow:none;
    padding:0;
  }

  label {
    font-size:0.75em;
    color: var(--app-dark-text-color-light);
    font-weight:normal;
    margin:0;
    margin-top:1em;
  }

  select {
    border:0;
    font-size:16px;
    font-family:var( --app-default-font-family);
    -webkit-appearance:none;
    background-color:transparent;
  }

</style>
`;
