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

import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import didYouMean from 'didyoumean';
import chalk from 'chalk';
import type Environment from 'yeoman-environment';
import type { BaseEnvironmentOptions, GeneratorMeta, LookupOptions } from '@yeoman/types';

import { packageJson } from '../lib/index.js';
import { packageNameToNamespace } from '../lib/utils/index.js';
import baseCommand from '../generators/base/command.js';
import { GENERATOR_APP, GENERATOR_BOOTSTRAP, GENERATOR_JDL } from '../generators/generator-list.js';
import { extractArgumentsFromConfigs, type JHipsterCommandDefinition } from '../lib/command/index.js';
import { buildJDLApplicationConfig } from '../lib/command/jdl.js';
import logo from './logo.mjs';
import EnvironmentBuilder from './environment-builder.mjs';
import SUB_GENERATORS from './commands.mjs';
import JHipsterCommand from './jhipster-command.mjs';
import { CLI_NAME, done, getCommand, logger } from './utils.mjs';
import type { CliCommand } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { version: JHIPSTER_VERSION } = packageJson;
const JHIPSTER_NS = CLI_NAME;

const moreInfo = `\n  For more info visit ${chalk.blue('https://www.jhipster.tech')}\n`;

type BuildCommands = {
  program: JHipsterCommand;
  commands?: Record<string, CliCommand>;
  envBuilder?: EnvironmentBuilder;
  env: Environment;
  loadCommand?: (key: string) => Promise<(...args: any[]) => Promise<any>>;
  defaultCommand?: string;
  entrypointGenerator?: string;
  silent?: boolean;
  printLogo?: () => void | Promise<void>;
  printBlueprintLogo?: () => void | Promise<void>;
  createEnvBuilder: (options?: BaseEnvironmentOptions) => Promise<EnvironmentBuilder>;
};

type BuildJHipsterOptions = Partial<BuildCommands> & {
  executableName?: string;
  executableVersion?: string;
  blueprints?: Record<string, string>;
  lookups?: LookupOptions[];
  devBlueprintPath?: string;
};

type JHipsterModule = {
  command?: JHipsterCommandDefinition;
  default: any;
};

export const printJHipsterLogo = () => {
  // eslint-disable-next-line no-console
  console.log();
  // eslint-disable-next-line no-console
  console.log(logo);
};

const buildAllDependencies = async (
  generatorNames: string[],
  { env, blueprintNamespaces = [] }: { env: Environment; blueprintNamespaces?: string[] },
): Promise<Record<string, { meta: GeneratorMeta; blueprintNamespace: string }>> => {
  const allDependencies = {};

  const registerDependency = async ({
    namespace,
    blueprintNamespace,
  }: {
    namespace: string;
    blueprintNamespace?: string;
  }): Promise<JHipsterModule> => {
    const meta = await env.getGeneratorMeta(namespace.includes(':') ? namespace : `${JHIPSTER_NS}:${namespace}`);
    if (meta) {
      allDependencies[namespace] = { meta, blueprintNamespace };
    } else if (!blueprintNamespace) {
      logger.warn(`Generator ${namespace} not found.`);
    }
    return (await meta?.importModule?.()) as JHipsterModule;
  };

  const lookupDependencyOptions = async ({ namespace, blueprintNamespace }: { namespace: string; blueprintNamespace?: string }) => {
    const lookupGeneratorAndImports = async ({ namespace, blueprintNamespace }) => {
      const module = await registerDependency({ namespace, blueprintNamespace });
      if (module?.command?.import) {
        for (const generator of module?.command?.import ?? []) {
          await lookupDependencyOptions({ namespace: generator, blueprintNamespace });
        }
      }
      return module?.command?.override;
    };

    let overridden = false;
    if (!namespace.includes(':')) {
      for (const nextBlueprint of blueprintNamespaces) {
        const blueprintSubGenerator = `${nextBlueprint}:${namespace}`;
        if (!allDependencies[blueprintSubGenerator]) {
          if (await lookupGeneratorAndImports({ namespace: blueprintSubGenerator, blueprintNamespace: nextBlueprint })) {
            overridden = true;
          }
        }
      }
    }

    if (!overridden && !allDependencies[namespace]) {
      await lookupGeneratorAndImports({ namespace, blueprintNamespace });
    }
  };

  for (const generatorName of generatorNames) {
    await lookupDependencyOptions({ namespace: generatorName });
  }
  return allDependencies;
};

const addCommandGeneratorOptions = async (
  command: JHipsterCommand,
  generatorMeta,
  { root, blueprintOptionDescription, info }: { root?: boolean; blueprintOptionDescription?: string; info?: string } = {},
) => {
  const generatorModule = (await generatorMeta.importModule()) as JHipsterModule;
  if (generatorModule.command) {
    const { configs } = generatorModule.command;
    if (configs) {
      command.addJHipsterConfigs(configs, blueprintOptionDescription);
    }
  }
  try {
    if (
      generatorModule.command?.loadGeneratorOptions !== false &&
      (root || !generatorModule.command || generatorModule.command.loadGeneratorOptions)
    ) {
      const generator = await generatorMeta.instantiateHelp();
      // Add basic yeoman generator options
      command.addGeneratorOptions(generator._options, blueprintOptionDescription);
    }
  } catch (error) {
    if (!info) {
      throw error;
    }
    logger.verboseInfo(`${info}, error: ${error}`);
  }
};

const addCommandRootGeneratorOptions = async (command, generatorMeta, { usage = true } = {}) => {
  const generatorModule = await generatorMeta.importModule();
  if (generatorModule.command) {
    command.addJHipsterArguments(generatorModule.command.arguments ?? extractArgumentsFromConfigs(generatorModule.command.configs));
  } else {
    const generator = await generatorMeta.instantiateHelp();
    command.addGeneratorArguments(generator._arguments);
  }
  if (usage) {
    const usagePath = path.resolve(path.dirname(generatorMeta.resolved), 'USAGE');
    if (fs.existsSync(usagePath)) {
      command.addHelpText('after', `\n${fs.readFileSync(usagePath, 'utf8')}`);
    }
  }
};

export const createProgram = ({
  executableName = CLI_NAME,
  executableVersion,
}: { executableName?: string; executableVersion?: string } = {}) => {
  return (
    new JHipsterCommand()
      .name(executableName)
      .storeOptionsAsProperties(false)
      .version(executableVersion ? `${executableVersion} (generator-jhipster ${JHIPSTER_VERSION})` : JHIPSTER_VERSION)
      .addHelpText('after', moreInfo)
      // JHipster common options
      .option(
        '--blueprints <value>',
        'A comma separated list of one or more generator blueprints to use for the sub generators, e.g. --blueprints kotlin,vuejs',
      )
      .option('--force-insight', 'Force insight')
      .option('--no-insight', 'Disable insight')
      // Conflicter options
      .option('--force', 'Override every file', false)
      .option('--dry-run', 'Print conflicts', false)
      .option('--whitespace', 'Whitespace changes will not trigger conflicts', false)
      .option('--bail', 'Fail on first conflict', false)
      .option('--install-path', 'Show jhipster install path', false)
      .option('--skip-regenerate', "Don't regenerate identical files", false)
      .option('--skip-yo-resolve', 'Ignore .yo-resolve files', false)
      .addJHipsterConfigs(baseCommand.configs)
  );
};

const rejectExtraArgs = ({ program, command, extraArgs }) => {
  // if extraArgs exists: Unknown commands or unknown argument.
  const first = extraArgs[0];
  if (command.name() !== GENERATOR_APP) {
    logger.fatal(
      `${chalk.yellow(command.name())} command doesn't take ${chalk.yellow(first)} argument. See '${chalk.white(
        `${program.name()} ${command.name()} --help`,
      )}'.`,
    );
  }
  const availableCommands = program.commands.map(c => c._name);

  const suggestion = didYouMean(first, availableCommands);
  if (suggestion) {
    logger.verboseInfo(`Did you mean ${chalk.yellow(suggestion)}?`);
  }

  const message = `${chalk.yellow(first)} is not a known command. See '${chalk.white(`${CLI_NAME} --help`)}'.`;
  logger.fatal(message);
};

export const buildCommands = ({
  program,
  commands = {},
  envBuilder,
  env,
  loadCommand = async key => {
    const { default: command } = await import(`./${key}.mjs`);
    return command;
  },
  defaultCommand = GENERATOR_APP,
  entrypointGenerator,
  printLogo = printJHipsterLogo,
  printBlueprintLogo = () => {},
  createEnvBuilder,
  silent,
}: BuildCommands) => {
  /* create commands */
  Object.entries(commands).forEach(([cmdName, opts]) => {
    const { desc, blueprint, argument, options: commandOptions, alias, help: commandHelp, cliOnly, removed, useOptions = {} } = opts;
    program
      .command(cmdName, '', { isDefault: cmdName === defaultCommand, hidden: Boolean(removed) })
      .description(desc + (blueprint ? chalk.yellow(` (blueprint: ${blueprint})`) : ''))
      .addCommandArguments(argument!)
      .addCommandOptions(commandOptions)
      .addHelpText('after', commandHelp!)
      .addAlias(alias!)
      .excessArgumentsCallback(function (this, receivedArgs) {
        rejectExtraArgs({ program, command: this, extraArgs: receivedArgs });
      })
      .lazyBuildCommand(async function (this, operands) {
        logger.debug(`cmd: lazyBuildCommand ${cmdName} ${operands}`);
        if (removed) {
          logger.fatal(removed);
          return;
        }

        if (!silent) {
          await printLogo();
          await printBlueprintLogo();
        }

        const command = this;

        if (cmdName === 'run') {
          command.usage(`${operands} [options]`);
          operands = Array.isArray(operands) ? operands : [operands];
          command.generatorNamespaces = operands.map(
            namespace => `${namespace.startsWith(JHIPSTER_NS) ? '' : `${JHIPSTER_NS}-`}${namespace}`,
          );
          await envBuilder?.lookupGenerators(command.generatorNamespaces.map(namespace => `generator-${namespace.split(':')[0]}`));
          await Promise.all(
            command.generatorNamespaces.map(async namespace => {
              const generatorMeta = env.getGeneratorMeta(namespace.includes(':') ? namespace : `${JHIPSTER_NS}:${namespace}`);
              if (!generatorMeta) {
                logger.fatal(chalk.red(`\nGenerator ${namespace} not found.\n`));
              }

              await addCommandRootGeneratorOptions(command, generatorMeta, { usage: command.generatorNamespaces.length === 1 });
              await addCommandGeneratorOptions(command, generatorMeta, { root: true });
            }),
          );
          return;
        }

        if (!cliOnly) {
          const generator = blueprint ? `${packageNameToNamespace(blueprint)}:${cmdName}` : cmdName;
          const generatorMeta = env.getGeneratorMeta(generator.includes(':') ? generator : `${JHIPSTER_NS}:${generator}`);

          if (!generatorMeta) {
            return;
          }

          await addCommandRootGeneratorOptions(command, generatorMeta);

          // Add bootstrap options, may be dropped if every generator is migrated to new structure and correctly depends on bootstrap.
          const boostrapGen = [GENERATOR_BOOTSTRAP, generator];
          if (cmdName === GENERATOR_JDL) {
            boostrapGen.push(entrypointGenerator ?? GENERATOR_APP);
          }
          const allDependencies = await buildAllDependencies(boostrapGen, {
            env,
            blueprintNamespaces: envBuilder?.getBlueprintsNamespaces(),
          });
          for (const [metaName, { meta: generatorMeta, blueprintNamespace }] of Object.entries(allDependencies)) {
            if (blueprintNamespace) {
              const blueprintOptionDescription = chalk.yellow(` (blueprint option: ${blueprintNamespace.replace(/^jhipster-/, '')})`);
              await addCommandGeneratorOptions(command, generatorMeta, {
                blueprintOptionDescription,
                info: `Error parsing options for generator ${metaName}`,
              });
            } else {
              await addCommandGeneratorOptions(command, generatorMeta, { root: metaName === generator });
            }
          }
        }
        command.addHelpText('after', moreInfo);
      })
      .action(async (...everything) => {
        logger.debug('cmd: action');
        // [args, opts, command]
        const command = everything.pop();
        const cmdOptions = everything.pop();
        const args = everything;
        const commandsConfigs = Object.freeze({ ...command.configs, ...command.blueprintConfigs });
        const jdlDefinition = buildJDLApplicationConfig(commandsConfigs);
        const options = {
          ...program.opts(),
          ...cmdOptions,
          ...useOptions,
          commandName: cmdName,
          entrypointGenerator,
          blueprints: envBuilder?.getBlueprintsOption(),
          positionalArguments: args,
          jdlDefinition,
          commandsConfigs,
        };
        if (options.installPath) {
          // eslint-disable-next-line no-console
          console.log(path.dirname(__dirname));
          return Promise.resolve();
        }

        if (cliOnly) {
          logger.debug('Executing CLI only script');
          const cliOnlyCommand = await loadCommand(cmdName);
          return cliOnlyCommand instanceof Function
            ? cliOnlyCommand(args, options, env, envBuilder, createEnvBuilder)
            : Promise.reject(new Error(`Command ${cmdName} is not a function.`));
        }

        if (cmdName === 'run') {
          return Promise.all(command.generatorNamespaces.map(generator => env.run(generator, options))).then(
            results => silent || done(results.find(result => result)),
            errors => silent || done(errors.find(error => error)),
          );
        }
        if (cmdName === 'upgrade') {
          options.programName = program.name();
          options.createEnvBuilder = createEnvBuilder;
        }
        const namespace = blueprint ? `${packageNameToNamespace(blueprint)}:${cmdName}` : `${JHIPSTER_NS}:${cmdName}`;
        const generatorCommand = getCommand(namespace, args);
        const promise = env.run(generatorCommand as any, options);
        if (silent) {
          return promise;
        }
        return promise.then(done, done);
      });
  });
};

export const buildJHipster = async ({
  executableName,
  executableVersion,
  program = createProgram({ executableName, executableVersion }),
  blueprints,
  lookups,
  createEnvBuilder,
  envBuilder,
  commands,
  devBlueprintPath,
  env,
  ...buildOptions
}: BuildJHipsterOptions = {}) => {
  createEnvBuilder =
    createEnvBuilder ??
    (async options =>
      EnvironmentBuilder.create(options).prepare({ blueprints, lookups, devBlueprintPath } as {
        blueprints?: Record<string, string>;
        lookups?: any[];
        devBlueprintPath?: string;
      }));
  if (!env) {
    envBuilder = envBuilder ?? (await createEnvBuilder());
    env = env ?? envBuilder.getEnvironment();
    commands = { ...SUB_GENERATORS, ...(await envBuilder.getBlueprintCommands()), ...commands };
  } else {
    commands = { ...SUB_GENERATORS, ...commands };
  }

  buildCommands({
    ...buildOptions,
    program,
    commands,
    envBuilder,
    env,
    createEnvBuilder,
  });

  return program;
};

export const runJHipster = async (args: { argv?: string[] } & BuildJHipsterOptions = {}) => {
  const { argv = process.argv, ...buildJHipsterOptions } = args;
  const jhipsterProgram = await buildJHipster(buildJHipsterOptions);
  return jhipsterProgram.parseAsync(argv);
};

export { done };
