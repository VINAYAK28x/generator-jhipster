/**
 * Copyright 2013-2025 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see https://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { before, describe, it } from 'esmocha';
import { expect } from 'chai';
import { JDLEnum } from '../../core/models/index.js';
import EnumValidator from '../validators/enum-validator.js';

describe('jdl - EnumValidator', () => {
  let validator;

  before(() => {
    validator = new EnumValidator();
  });

  describe('validate', () => {
    describe('when not passing anything', () => {
      it('should fail', () => {
        expect(() => validator.validate()).to.throw(/^No enum\.$/);
      });
    });
    describe('when passing an enum', () => {
      describe('with all its required attributes', () => {
        let jdlEnum;

        before(() => {
          jdlEnum = new JDLEnum({
            name: 'a',
          });
        });

        it('should not fail', () => {
          expect(() => validator.validate(jdlEnum)).not.to.throw();
        });
      });
      describe('when not passing any attribute', () => {
        it('should fail', () => {
          expect(() => validator.validate({})).to.throw(/^The enum attribute name was not found\.$/);
        });
      });
    });
  });
});
