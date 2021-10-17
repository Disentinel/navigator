let fs = require('fs');
let babel = require('@babel/parser');
let _ = require('lodash')

const DIRECTORY = '/home/vadimr/zon3/pkg/';

const E = module.exports;

E.get_circle_coord = (center, radius, angle) => {
    return {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
    }
}

E.circle_steps = [3, 12, 20, 50, 120, 360, 720, 1400, 5000];

E.get_circle_step = n => {
    return E.circle_steps.findIndex(v => v > n);
}

E.get_circle_point = n => {
    let step = E.get_circle_step(n);
    if (step == -1)
        throw new Error('too many nodes');
    let radius = 10 + 25 * step;
    let center = { x: 0, y: 0 };
    let angle = ((Math.PI / E.circle_steps[step]) * n);
    return E.get_circle_coord(center, radius, angle);
}

E.get_linear_point = n => {
    let row = Math.floor(n / 5);
    let column = n % 5;
    return { x: 1000 * column, y: 100 * row }
}

E.get_files = (files, path) => {
    let list = fs.readdirSync(path, { withFileTypes: true });
    list.forEach(dirent => {
        if (dirent.isFile()) {
            if (dirent.name.endsWith('.js'))
                files.push(path + dirent.name);
        } else if (dirent.isDirectory()) {
            E.get_files(files, path + dirent.name + '/');
        }
    })
    return files;
}

E.parse_file = path => {
    let content = fs.readFileSync(path).toString();
    return babel.parse(content, {
        sourceType: 'unambiguous',
        plugins: ["jsx"]
    })
}

let NODES = new Map();

E.handle_node_children = (fname, node, to_handle, parsed) => {
    try {
        let { loc: { start, end } } = node;
        let unique_id = `${fname}:l${start.line}c${start.column}-l${end.line}c${end.column}:${node.type}`;
        //if (NODES.has(unique_id))
        //    throw new Error(`Non unique ID!`)
        NODES.set(unique_id, node);
        if (!E.handlers[node.type] || E.handlers[node.type].disable)
            throw new Error(`No handler for ${node.type}`)
        let children = E.handlers[node.type].get_children(node);
        children.filter(Boolean).forEach(c => {
            c.parent = unique_id;
            to_handle.push(c)
        });
        node.unique_id = unique_id;
        parsed.push(node);
    } catch (e) {
        //  DEBUG
        throw e;
        throw econsole.log(`Failed to parse node`, e.message);
        if (!E.handlers[node.type] || E.handlers[node.type].disable)
            console.log(node, {
                [node.type]: Object.keys(node).filter(key => !['type', 'start', 'end', 'loc'].includes(key))
            });
    }
}

E.handle_links = (node, parsed) => {
    if (!E.handlers[node.type] || E.handlers[node.type].disable || !E.handlers[node.type].get_links) {
        console.log(node, {
            [node.type]: Object.keys(node).filter(key => !['type', 'start', 'end', 'loc'].includes(key))
        });
        throw new Error(`No handler for ${node.type}`)
    }
    let links = E.handlers[node.type].get_links(node);
    links.push({from: guid(node), to: node.parent, kind: 'child_of'})
    links.filter(Boolean).forEach(c => {
        parsed.push(c)
    });
}

E.handle_ast = (AST, fname) => {
    NODES = new Map();
    AST.fname = fname;
    let nodes_to_handle = [AST];
    let parsed_nodes = [];
    while (nodes_to_handle.length > 0)
        E.handle_node_children(fname, nodes_to_handle.pop(), nodes_to_handle, parsed_nodes);
    let parsed_links = [];
    parsed_nodes.forEach(n => E.handle_links(n, parsed_links));
    console.log(parsed_nodes);
    return { nodes: parsed_nodes, edges: parsed_links };
}

E.parse = async () => {
/*    let nodes = [];
    let edges = [];*/

    let fname = DIRECTORY + '/www/login/login.js';
    let AST = E.parse_file(fname);
    let graph = E.handle_ast(AST, fname);

    console.log(graph);

    let result = {
        nodes: graph.nodes.map(n=>_.pick(n, [
            'unique_id', 'type', 'value', 'operator', 
            'name'
        ])),
        links: graph.edges
    };

    fs.writeFileSync('graph.json', JSON.stringify(result))

    return result;
}

let guid = n => {
    if (!n)
        throw new Error('Bad node!');
    return n.unique_id
}

E.handlers = {
    'File': {
        get_children: n => {[n.program]},
        get_links: n => {
            n.context = n.unique_id; 
            return [{ from: guid(n.program), to: guid(n), kind: 'executed_by' }]
        }
    },
    'Program': {
        get_children: n => n.body,
        get_links: n => {
            let links = [];
            n.body.forEach(c => {
                links.push({ from: guid(c), to: guid(n), kind: 'executed_by' })
            })
            return links
        }
    },
    'VariableDeclaration': {
        get_children: n => n.declarations,
        get_links: n => {
            let links = [];
            n.declarations.forEach(c => {
                links.push({ from: guid(c), to: guid(n), kind: 'executed_by' })
                links.push({ from: guid(c), to: n.parent, kind: 'export_value_to' })
            })
            return links
        }
    },
    'VariableDeclarator': {
        get_children: n => [n.id, n.init],
        get_links: n => {
            let links = [];
            if (n.init)
                links.push({ from: guid(n.init), to: guid(n.id), kind: 'init_by' })
            links.push({ from: guid(n.id), to: n.parent, kind: 'provide_value_to' })
            return links
        }
    },
    'Identifier': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_value_to' }]
    },
    'CallExpression': {
        get_children: n => [n.callee, ...n.arguments],
        get_links: n => {
            let links = [];
            links.push({ from: guid(n.callee), to: guid(n), kind: 'called_by' })
            n.arguments.forEach(c => {
                links.push({ from: guid(c), to: guid(n), kind: 'used_by' })
                links.push({ from: guid(n.callee), to: guid(c), kind: 'called_with' })
            })
            return links
        }
    },
    'MemberExpression': {
        get_children: n => [n.object, n.property],
        get_links: n => {
            let links = [];
            links.push({ from: n.parent, to: guid(n), kind: 'use_context_of' })
            links.push({ from: guid(n), to: guid(n.object), kind: 'use_context_of' })
            links.push({ from: guid(n.object), to: guid(n.property), kind: 'use_value_of' })
            return links
        }
    },
    'StringLiteral': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_value_to' }]
    },
    'ExpressionStatement': {
        get_children: n => [n.expression],
        get_links: n => [{ from: guid(n.expression), to: guid(n), kind: 'executed_by' }]
    },
    'AssignmentExpression': {
        get_children: n => [n.left, n.right],
        get_links: n => {
            let links = [];
            if (n.operator !== '=')
                links.push({ from: guid(n.left), to: guid(n.right), kind: 'modified_with' })
            else
                links.push({ from: guid(n.right), to: guid(n.left), kind: 'assign_to' });
            links.push({ from: guid(n), to: guid(n.left), kind: 'modified_by' })
            return links
        }
    },
    'ObjectPattern': {
        get_children: n => n.properties,
        get_links: n => n.properties.map(p => ({ from: guid(p), to: guid(n), kind: 'provide_value_to' }))
    },
    'ObjectProperty': {
        get_children: n => [n.value, n.key],
        get_links: n => {
            let links = [];
            links.push({ from: guid(n), to: guid(n.value), kind: 'use_value_of' })
            links.push({ from: n.parent, to: guid(n), kind: 'use_context_of' })
            links.push({ from: guid(n.value), to: guid(n.key), kind: 'provide_value_to' })
            return links
        }
    },
    'NewExpression': {
        get_children: n => [n.callee, ...n.arguments],
        get_links: n => {
            let links = [];
            links.push({ from: guid(n), to: guid(n.callee), kind: 'use_value_of' })
            n.arguments.forEach(arg => {
                links.push({ from: guid(arg), to: guid(n.callee), kind: 'use_value_of' })
            })
            links.push({ from: n.parent, to: guid(n), kind: 'use_value_of' })
            return links
        }
    },
    'ArrowFunctionExpression': {
        get_children: n => [n.id, ...n.params, n.body],
        get_links: n => {
            let links = [];
            n.context = n.unique_id;
            if (n.id)
                links.push(rom: guid(n), to: guid(n.id), kind: 'assign_to' });
            n.params.forEach(p => {
                links.push({ from: guid(n), to: guid(p), kind: 'used_by' })
            })
            links.push({ from: guid(n.body), to: guid(n), kind: 'executed_by' })
            return links
        }
    },
    'BlockStatement': {
        get_children: n => n.body,
        get_links: n => {
            let links = [];
            n.context = n.unique_id;
            n.body.forEach(c => {
                links.push({ from: guid(c), to: guid(n), kind: 'executed_by' })
            })
            return links
        }
    },
    'NumericLiteral': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_value_to' }]
    },
    'ConditionalExpression': {
        get_children: n => [n.test, n.consequent, n.alternate],
        get_links: n => [
            { from: guid(n.test), to: guid(n), kind: 'executed_by' },
            { from: guid(n.consequent), to: n.parent, kind: 'provide_value_to' },
            { from: guid(n.alternate), to: n.parent, kind: 'provide_value_to' },
        ]
    },
    'LogicalExpression': {
        get_children: n => [n.left, n.right],
        get_links: n => [
            { from: guid(n), to: guid(n.left), kind: 'use_value_of' },
            { from: guid(n), to: guid(n.right), kind: 'use_value_of' },
            { from: guid(n), to: n.parent, kind: 'provide_value_to' },
        ]
    },
    'BinaryExpression': {
        get_children: n => [n.left, n.right],
        get_links: n => [
            { from: guid(n), to: guid(n.left), kind: 'use_value_of' },
            { from: guid(n), to: guid(n.right), kind: 'use_value_of' },
            { from: guid(n), to: n.parent, kind: 'provide_value_to' },
        ]
    },
    'FunctionExpression': {
        get_children: n => [n.id, ...n.params, n.body],
        get_links: n => {
            let links = [];
            n.params.forEach(p => links.push(
                { from: guid(n), to: guid(p), kind: 'use_value_of' }));
            links.push({ from: guid(n.body), to: guid(n), kind: 'executed_by' })
            links.push({ from: guid(n), to: n.parent, kind: 'provide_value_to' })
            return links;
        }
    },
    'YieldExpression': {
        get_children: n => [n.argument],
        get_links: n => [
            { from: guid(n.argument), to: guid(n), kind: 'use_value_of' },
            { from: guid(n.argument), to: n.parent, kind: 'use_value_of' },
            { from: guid(n), to: n.parent, kind: 'pause_execution' },
        ]
    },
    'UnaryExpression': {
        get_children: n => [n.argument],
        get_links: n => [{ from: n.parent, to: guid(n), kind: 'modified_by' }]
    },
    'ObjectExpression': {
        get_children: n => n.properties,
        get_links: n => {
            let links = [];
            n.properties.forEach(p => {
                links.push({ from: guid(n), to: guid(p), kind: 'use_value_of' })
                links.push({ from: n.parent, to: guid(p), kind: 'use_value_of' })
            });
            links.push({ from: n.parent, to: guid(n), kind: 'use_context_of' })
            return links
        }
    },
    'BooleanLiteral': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_value_to' }]
    },
    'IfStatement': {
        get_children: n => [n.test, n.consequent, n.alternate],
        get_links: n => {
            console.log(n);
            let links = [];
            links.push({ from: guid(n.test), to: guid(n), kind: 'executed_by' })
            links.push({ from: guid(n.consequent), to: guid(n), kind: 'conditional_executed_by' })
            if (n.alternate)
                links.push({ from: guid(n.alternate), to: guid(n), kind: 'conditional_executed_by' })
            return links
        }
    },
    'RegExpLiteral': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_value_to' }]
    },
    'ReturnStatement': {
        get_children: n => [n.argument],
        get_links: n => {
            let links = [];
            links.push({ from: guid(n), to: n.parent, kind: 'break_execution_of' })
            if (n.argument) {
                links.push({ from: guid(n), to: guid(n.argument), kind: 'executed_by' })
                links.push({ from: guid(n.argument), to: n.parent, kind: 'result_of' })
            }
            return links
        }
    },
    'TryStatement': {
        get_children: n => [n.block, n.handler, n.finalizer],
        get_links: n => {
            let links = [];
            if (n.finalizer)
                links.push({ from: guid(n.finalizer), to: guid(n), kind: 'executed_by' })
            links.push({ from: guid(n.block), to: guid(n), kind: 'executed_by' })
            if (n.handler)
                links.push({ from: guid(n.handler), to: guid(n), kind: 'conditional_executed_by' })
            return links
        }
    },
    'CatchClause': {
        get_children: n => [n.param, n.body],
        get_links: n => {
            let links = [];
            if (n.param)
                links.push({ from: guid(n.param), to: guid(n), kind: 'used_by' })
            links.push({ from: guid(n.body), to: guid(n), kind: 'executed_by' })
            return links
        }
    },
    'ThrowStatement': {
        get_children: n => [n.argument],
        get_links: n => {
            let links = [];
            links.push({ from: guid(n), to: n.parent, kind: 'break_execution_of' })
            links.push({ from: guid(n.argument), to: guid(n), kind: 'executed_by' })
            return links
        }
    },
    'ArrayExpression': {
        get_children: n => n.elements,
        get_links: n => n.elements.filter(Boolean).map(e => ({ from: guid(e), to: guid(n), kind: 'provide_value_to' }))
    },
    'NullLiteral': {
        get_children: n => [],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' }
        ]
    },
    'TemplateLiteral': {
        get_children: n => [...n.quasis, ...n.expressions],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' }
        ]
    },
    'TemplateElement': {
        get_children: n => [],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' }
        ]
    },
    'AssignmentPattern': {
        get_children: n => [n.left, n.right],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' },
            { from: guid(n), to: guid(n.left), kind: 'use_value_of' },
            { from: guid(n.left), to: guid(n.right), kind: 'use_value_of' }
        ]
    },
    'ThisExpression': {
        get_children: n => [],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'provide_context_to' }]
    },
    'FunctionDeclaration': {
        get_children: n => [n.id, ...n.params, n.body],
        get_links: n => {
            let links = [];
            if (n.id)
                links.push({ from: guid(n), to: guid(n.id), kind: 'assign_to' });
            n.params.forEach(p => {
                links.push({ from: guid(n), to: guid(p), kind: 'used_by' })
            })
            links.push({ from: guid(n.body), to: guid(n), kind: 'executed_by' })
            return links
        }
    },
    'UpdateExpression': {
        get_children: n => [n.argument],
        get_links: n => [{ from: n.parent, to: guid(n), kind: 'modified_by' }]
    },
    'TaggedTemplateExpression': {
        get_children: n => [n.tag, n.quasi],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' }
        ]
    },
    'SpreadElement': {
        get_children: n => [n.argument],
        get_links: n => [
            { from: n.parent, to: guid(n), kind: 'use_value_of' }
        ]
    },
    'ForOfStatement': {
        get_children: n => [n.left, n.right, n.body],
        get_links: n => [
            { from: guid(n.left), to: guid(n.right), kind: 'modified_by' },
            { from: guid(n.body), to: guid(n), kind: 'conditional_executed_by' },
            { from: guid(n.left), to: guid(n.body), kind: 'provide_value_to' },
        ]
    },
    'BreakStatement': {
        get_children: n => [n.label],
        get_links: n => [{ from: guid(n), to: n.parent, kind: 'break_execution_of' }]
    },
    'ArrayPattern': {
        get_children: n => n.elements,
        get_links: n => n.elements.filter(Boolean).map(e => ({ from: guid(e), to: guid(n), kind: 'provide_value_to' }))
    },
    '': {
        get_children: n => []
    },
    '': {
        get_children: n => []
    },
    '': {
        get_children: n => []
    },
    '': {
        get_children: n => []
    },
    '': {
        get_children: n => []
    },
}