export default {
    descriptions: {
        budget: '**:green_circle: Budget**',
        premium: '**:blue_circle: Premium**',
        pro: '**:purple_circle: Pro**',
    },
    type: {
        budget: {
            rate: 12,
            description: 'Utility plugin'
        },
        premium: {
            rate: 14,
            description: 'Game plugin __without__ BungeeCord support'
        },
        pro: {
            rate: 16,
            description: 'Game plugin __with__ BungeeCord support'
        }
    },
    testing: {
        budget: {
            rate: 0,
            description: 'Rapid test, one environment'
        },
        premium: {
            rate: 5,
            description: 'System tests after adding features, 2-4 environments'
        },
        pro: {
            rate: 10,
            description: 'Smoke tests after adding features, as many environments as possible with as many possible (config) setups'
        }
    },
    messages: {
        budget: {
            rate: 0,
            description: 'Hardcoded messages & items'
        },
        premium: {
            rate: 5,
            description: 'Customizable messages, hardcoded items'
        },
        pro: {
            rate: 10,
            description: 'Customizable messages & items'
        }
    },
    commands: {
        budget: {
            rate: 0,
            description: 'Regular commands to execute tasks'
        },
        premium: {
            rate: 2.50,
            description: 'Commands with auto-completion'
        },
        pro: {
            rate: 5,
            description: 'Commands to change config options'
        }
    },
    versions: {
        budget: {
            rate: 0,
            description: 'Written for one specific version'
        },
        premium: {
            rate: 5,
            description: 'Ability to run on 1.12- and 1.13+ with one NMS version when required'
        },
        pro: {
            rate: 15,
            description: 'Ability to run on max 4 flagship versions, with full NMS support'
        }
    },
    allow_publication: {
        rate: -15,
        description: '*In exchange for a 15 EUR discount, I hereby authorize GCNT to publish this plugin as a premium resource ' +
            'one month after the first version was made available to me. This only applies to resources that meet our premium requirements.*'
    },
}