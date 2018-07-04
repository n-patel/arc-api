'use strict'

const stdog = require('./stardog-connectors/query_construction')
const uuid = require('node-uuid')

const local_to_global_id_map = {}

module.exports.fromJSON = async function(json_object) {
    let nodes = json_object['nodes']
    let links = json_object['links']

    nodes = nodes.map(fixNodeID)
    links = links.map(fixLinkID)
    console.log('Nodes and links fixed!')

    await nodes.forEach(entity => {
        const entity_id = entity['id']
        stdog.create_entity(entity_id, entity['label'], entity['type'])

        const attributes = entity['attributes']
        attributes.forEach(attr => {
            const claim_id = get_new_claim_id()
            stdog.add_property_claim(claim_id, entity_id)
            stdog.add_claim_key_and_value(claim_id, attr['key'], attr['value'])

            // var attr_sources = attr["sources"]
            // attr_sources.forEach(src_tuple => {
            //     stdog.add_claim_source(claim_id, src_tuple[0])
            //     //TODO: add claim user
            // });

            // var attr_metadata = attr["metadata"]
            // attr_metadata.forEach(metadata => {
            //     //TODO: figure out which claim_id to use, then add metadata
                
            // });
        })
    })

    await stdog.execute()

    await links.forEach(link => {
        const claim_id = get_new_claim_id()

        stdog.connect_entities(link['sourceID'],link['targetID'], claim_id)
        stdog.add_claim_relation(claim_id, link['relationshipType'])

        // var data = link["data"]
        // data.forEach(datapoint => {
        //     //TODO: handle metadata addition
        // });
    })

    await stdog.execute()
    
}

function fixNodeID(node) {
    const given_id = node.id
    if (!local_to_global_id_map[given_id]) {
        const new_id = get_new_entity_id()
        local_to_global_id_map[given_id] = new_id
        node.id = new_id
    }

    return node
}

function fixLinkID(link) {
    const sid = link.sourceID
    const oid = link.targetID

    const mapped_sid = local_to_global_id_map[sid]
    const mapped_oid = local_to_global_id_map[oid]

    if (mapped_sid) {
        link.sourceID = mapped_sid
    }
    if (mapped_oid) {
        link.targetID = mapped_oid
    }

    return link
}

function get_new_claim_id() {
    const claim_id = 'claim' + uuid.v4()
    return claim_id
}

function get_new_entity_id() {
    const entity_id = 'entity' + uuid.v4()
    return entity_id
}

async function id_to_json(entity_id) {
    // grab the entity ID without boilerplate namespacing
    entity_id = entity_id.replace('http://ont/entity', '')

    const label_response = await stdog.get_label(entity_id)
    const type_response = await stdog.get_type(entity_id)
    const claims_response = await stdog.get_claims(entity_id)
    const links_response = await stdog.get_linked_entities(entity_id)

    const label = label_response.body.results.bindings[0].name.value
    const type = type_response.body.results.bindings[0].type.value
    const properties = claims_response.body.results.bindings
    const links = links_response.body.results.bindings

    const json = {
        nodes: [{
            id: entity_id,
            label: label,
            type: type,
            attributes: [],
        }],
        links: [],
    }

    const prop_list = json.nodes[0].attributes
    const link_list = json.links

    properties.forEach(p => {
        prop_list.push({
            claim_id: p.claim_id.value,
            key: p.claim_type.value,
            value: p.claim_value.value,
        })
    })

    links.forEach(l => {
        link_list.push({
            claim_id: l.claim_id.value,
            sourceID: 'http://ont/entity' + entity_id,       /* TODO this should be changed to be flexible with the namespace */
            targetID: l.entity_id.value,
            relationshipType: l.relationship.value
        })
    })
    
    return json
}

async function list_to_json(entity_ids) {
    const jsons = []

    const waiting = entity_ids.map(async (id) => {
        const json = await id_to_json(id)
        jsons.push(json)
    })

    await Promise.all(waiting)

    return zipResults(jsons)
}

function zipResults(results) {
    const res = {
        nodes: [],
        links: [],
    }

    results.forEach(r => {
        res.nodes = res.nodes.concat(r.nodes)
        res.links = res.links.concat(r.links)
    })

    return res
}

module.exports.nameToJSON = async function(name) {
    const id_response = await stdog.name_to_id(name)
    const id = id_response.body.results.bindings[0].entity_id.value

    const json = await module.exports.toJSON(id)

    return json
}

module.exports.toJSON = id_to_json
module.exports.toJSONs = list_to_json
