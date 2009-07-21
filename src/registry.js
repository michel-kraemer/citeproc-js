dojo.provide("csl.registry");

//
// Time for a rewrite of this module.
//
// Simon has pointed out that list and hash behavior can
// be obtained by ... just using a list and a hash.  This
// is faster for batched operations, because sorting is
// greatly optimized.  Since most of the interaction
// with plugins at runtime will involve batches of
// references, there will be solid gains if the current,
// one-reference-at-a-time approach implemented here
// can be replaced with something that leverages the native
// sort method of the Array() type.
//
// That's going to take some redesign, but it will simplify
// things in the long run, so it might as well happen now.
//
// We'll keep makeCitationCluster and makeBibliography as
// simple methods that return a string.  Neither should
// have any effect on internal state.  This will be a change
// in behavior for makeCitationCluster.
//
// A new updateItems command will be introduced, to replace
// insertItems.  It will be a simple list of IDs, in the
// sequence of first reference in the document.
//
// The calling application should always invoke updateItems
// before makeCitationCluster.
//

//
// should allow batched registration of items by
// key.  should behave as an update, with deletion
// of items and the tainting of disambiguation
// partner sets affected by a deletes and additions.
//
//
// we'll need a reset method, to clear the decks
// in the citation area and start over.

/**
 * Registry of cited items.
 * <p>This is a persistent store of disambiguation and
 * sort order information relating to individual items
 * for which rendering is requested.  Item data is stored
 * in a hash, with the item key as hash key, for quick
 * retrieval.  A virtual sequence within the hashed store
 * is maintained on the fly as items are added to the
 * store, using <code>*_next</code> and <code>*_prev</code>
 * attributes on each item.  A separate hash of items
 * based on their undisambiguated cite form is
 * maintained, and the item id list and disambiguation
 * level for each set of disambiguation partners is shared
 * through the registry item.</p>
 * @class
 */
CSL.Factory.Registry = function(state){
	this.registry = new Object();
	this.reflist = new Array();
	this.namereg = new CSL.Factory.Registry.NameReg(state);
	//
	// shared scratch vars
	this.mylist = new Array();
	this.myhash = new Object();
	this.deletes = new Array();
	this.inserts = new Array();
	this.dbupdates = new Object();
	//
	// each ambig is a list of the ids of other objects
	// that have the same base-level rendering
	this.ambigs = new Object();
	this.start = false;
	this.end = false;
	this.initialized = false;
	this.skip = false;
	this.maxlength = 0;

	//
	// XXXXX: This could be a problem.  May not work to feed a method of
	// this object to Array.sort().
	this.sorter = new CSL.Factory.Registry.Comparifier(state,"bibliography_sort");

	this.getSortedIds = function(){
		var step = "next";
		var item_id = this.start;
		var ret = new Array();
		while (true){
			ret.push(item_id);
			item_id = this.registry[item_id][step];
			if ( ! item_id){
				break;
			}
		}
		return ret;
	};

};

//
// Here's the sequence of operations to be performed on
// update:
//
//  1. (o) [init] Receive list as function argument.
//  2. (o) [init] Initialize delete and insert hash stores with items that have changed
//         in the DB.

//  3. (o) [getdeletes] Identify items for deletion, add to deletes list.
//  4. (o) [getinserts] Identify items for explicit insertion, add to inserts list.

//  5. (o) [delnames] Delete names in items to be deleted from names reg, and obtain IDs
//         of other items that would be affected by changes around that surname.
//  6. (o) [delnames] Complement delete and insert lists with items affected by
//         possible name changes.
//  7. (o) [delambigs] Delete all items to be deleted from their disambig pools.
//  8. ( ) [delhash] Delete all items in deletion list from hash.  Do this will
//         a sort-and-slice, applying a sort function like that
//         described under step 13, below.
//         XXXXX: this is mixed up.  there are two objects, hash and array.
//         XXXXX: both of them need to be culled.

//  9. ( ) Retrieve entries for items to insert.
// 10. ( ) Add names in items to be inserted to names reg.
// 11. ( ) Add items to be inserted to their disambig pools.
// 12. ( ) Add items for insert to hash, with ambig keys, adding
//         the ambig keys to the record of affected ambig pools.

// 13. ( ) Create "new" list of hash pointers ... append items to the list,
//         and then apply a bespoke sort function that forces items into the order of
//         the received list.  Here's a sort function that will do that:
//
//     var sortme = function(a,b){
//         if(origlist.indexOf(a) < origlist.indexOf(b)){
//             return -1
//         } else{
//             return 1
//         }
//     }
//
//     var origlist = ["Item1","Item2"]
//
//     Usage: newlist.sort(sortme)
//     (where newlist has the same elements as origlist, but possibly in a different order)
//

// 14. ( ) Apply citation numbers to new list.
// 15. ( ) Rerun disambiguation once for each affected disambig pool.
// 16. ( ) Reset sort keys stored in items
// 17. ( ) Resort list
// 18. ( ) Reset citation numbers on list items
//

CSL.Factory.Registry.prototype.init = function(myitems){
	//  1. Receive list as function argument.
	this.mylist = myitems;
	this.myhash = new Object();
	for each (var item in myitems){
		this.myhash[item] = true;
	};
	//
	//  2. Initialize delete and insert hash stores with items that have changed
	//    in the DB.
	this.deletes = new Object();
	this.inserts = new Object();
	for (var item in this.dbupdates){
		this.deletes[item] = true;
		this.inserts[item] = true;
	};
};

CSL.Factory.Registry.prototype.getdeletes = function(){
	//
	//  3. Identify items for deletion, add to deletes list.
	//
	for (var item in this.registry){
		if (!this.myhash[item]){
			this.deletes[item] = true;
		};
	};
};

CSL.Factory.Registry.prototype.getinserts = function(){
	//
	//  4. Identify items for explicit insertion, add to inserts list.
	//
	for (var item in this.myhash){
		if (!this.registry[item]){
			this.inserts[item] = true;
		};
	};
};

CSL.Factory.Registry.prototype.delnames = function(){
	//
	//  5. Delete names in items to be deleted from names reg, and obtain IDs
	//     of other items that would be affected by changes around that surname.
	//
	for (var item in this.deletes){
		var otheritems = this.namereg.delitems(this.deletes);
		//
		//  6. Complement delete and insert lists with items affected by
		//     possible name changes.
		//
		for (var i in otheritems){
			this.deletes[i] = true;
		};
		for (var i in otheritems){
			this.inserts[i] = true;
		};
	};
};

CSL.Factory.Registry.prototype.delambigs = function(){
	//
	//  7. Delete all items to be deleted from their disambig pools.
	//
	for (var item in this.deletes){
		var ambig = this.registry[item].ambig;
		var pos = this.ambigs[ambig].indexOf(item);
		if (pos > -1){
			var items = this.ambigs[ambig].slice();
			this.ambigs[ambig] = items.slice(0,pos).concat(items.slice([pos+1],items.length));
		}
	};
};

CSL.Factory.Registry.prototype.reconcile = function(){
	var mylisthash = new Object();
	//
	// record insert IDs
	for each (var item in this.worklist){
		if (!this.registry[item]){
			this.inserts.push(item);
		} else {
			mylisthash[item] = true;
		};
	};
	//
	// finish out mylisthash
	for each (var item in this.inserts){
		mylisthash[item] = true;
	};
	//
	// record delete IDs
	for each (var item in this.reflist){
		if (!mylisthash[item]){
			this.deletes.push(item);
		}
	};
	//
	// done with worklist
	this.worklist = new Array();
};

CSL.Factory.Registry.prototype.delitems = function(){
	//
	// delete from registry hash
	//for each (var item in this.deletes){
	//	delete this.registry[item];
	//};
	//
	// delete names associated with deleted items from names registry
	//for each (var item in this.deletes){
	//	this.namereg.del(item);
	//};
};

//
// This will disappear.
//
CSL.Factory.Registry.prototype.insert = function(state,Item){
	//
	// abort if we've already inserted
	if (this.debug){
		print("---> Start of insert");
	}
	if (this.registry[Item.id]){
		return;
	}
	//
	// get the sort key (it's an array containing
	// multiple key strings).
	var sortkeys = state.getSortKeys(Item,"bibliography_sort");
	//
	// get the disambiguation key and register it
	//
	var akey = state.getAmbiguousCite(Item);
	var abase = state.getAmbigConfig();
	var modes = state.getModes();
	//
	// registryItem instantiates an object with a copy of the
	// sort key, and a list shared with
	// disambiguation partners, if any, maintained
	// in sort key order.
	// (after this, we're ready to roll for the insert)
	var newitem = {
		"id":Item.id,
		"seq":1,
		"dseq":0,
		"sortkeys":sortkeys,
		"disambig":abase,
		"prev":false,
		"next":false
	};
	//
	// if the registry is empty, initialize it with
	// this object.
	if (this.debug){
		print("---> Begin manipulating registry");
	}
	var breakme = false;
	if (!this.initialized){
		if (this.debug_sort){
			print("-->initializing registry with "+newitem.id);
		}
		this.registry[newitem.id] = newitem;
		this.start = newitem.id;
		this.end = newitem.id;
		this.initialized = true;
		//
		// XXXXX
		//this.registerAmbigToken(state,akey,Item.id,abase.slice());
		this.registerAmbigToken(state,akey,Item.id,abase);
		return;
	}
	// if this object is less than the first one,
	// insert it as the first.
	if (-1 == this.sorter.compareKeys(newitem.sortkeys,this.registry[this.start].sortkeys)){
		if (this.debug_sort){
			print("-->inserting "+newitem.id+" before "+this.start+" as first entry");
		}
		newitem.next = this.registry[this.start].id;
		this.registry[this.start].prev = newitem.id;
		newitem.prev = false;
		newitem.seq = 1;
		var tok = this.registry[this.start];
		this.incrementSubsequentTokens(tok);
		this.start = newitem.id;
		this.registry[newitem.id] = newitem;
		breakme = true;
	}
	// if this object is greater than the
	// last one, insert it as the last.
	if (-1 == this.sorter.compareKeys(this.registry[this.end].sortkeys,newitem.sortkeys)  && !breakme){
		if (this.debug_sort){
			print("-->inserting "+newitem.id+" after "+this.end+" as last entry");
		}
		newitem.prev = this.registry[this.end].id;
		this.registry[this.end].next = newitem.id;
		newitem.next = false;
		newitem.seq = (this.registry[this.end].seq + 1);
		this.end = newitem.id;
		this.registry[newitem.id] = newitem;
		breakme = true;
	}
	//
	// if we reach this, it's safe to iterate
	var curr = this.registry[this.end];
	while (true && !breakme){
		// compare the new token to be added with
		// the one we're thinking about placing it after.
		var cmp = this.sorter.compareKeys(curr.sortkeys,newitem.sortkeys);
		if (cmp == -1){
			if (this.debug_sort){
				print("-->inserting "+newitem.id+" after "+curr.id);
			}
			// insert mid-list, after the tested item
			this.registry[curr.next].prev = newitem.id;
			newitem.next = curr.next;
			newitem.prev = curr.id;
			curr.next = newitem.id;
			newitem.seq = (curr.seq+1);
			this.incrementSubsequentTokens(this.registry[newitem.next]);
			this.registry[newitem.id] = newitem;
			breakme = true;
			break;
		} else if (cmp == 2){
			breakme = true;
		} else if (cmp == 0) {
			// insert _after_, but this one is equivalent
			// to the comparison partner for sortkey purposes
			// (so we needed to provide for cases where the
			// inserted object ends up at the end of
			// the virtual list.)
			if (false == curr.next){
				if (this.debug_sort){
					print("-->inserting "+newitem.id+" after "+curr.id+" as last entry, although equal");
				}
				newitem.next = false;
				newitem.prev = curr.id;
				curr.next = newitem.id;
				newitem.seq = (curr.seq+1);
				//this.incrementSubsequentTokens(curr);
				this.registry[newitem.id] = newitem;
				this.end = newitem.id;
				breakme = true;
				break;
			} else {
				if (this.debug_sort){
					print("-->inserting "+newitem.id+" after "+curr.id+", although equal");
				}
				this.registry[curr.next].prev = newitem.id;
				newitem.next = curr.next;
				newitem.prev = curr.id;
				curr.next = newitem.id;
				newitem.seq = curr.seq;
				this.registry[newitem.id] = newitem;
				this.incrementSubsequentTokens(newitem);
				breakme = true;
				break;
			}
		}
		if (breakme){
			break;
		}
		//
		// we scan in reverse order, because working
		// from the initial draft of the code, this
		// makes it simpler to order cites in submission
		// order, when no sort keys are available.
		curr = this.registry[curr.prev];
	};
	if (this.debug){
		print("---> End of registry insert");
	}
	//
	// register the notional ambiguation config
	this.registerAmbigToken(state,akey,Item.id,abase);
	//
	// if there are multiple ambigs, disambiguate them
	if (this.ambigs[akey].length > 1){
		if (modes.length){
			if (this.debug){
				print("---> Names disambiguation begin");
			}
			var leftovers = this.disambiguateCites(state,akey,modes);
			if (this.debug){
				print("---> Names disambiguation done");
			}
			//
			// leftovers is a list of registry tokens.  sort them.
			leftovers.sort(this.compareRegistryTokens);
		} else {
			//
			// if we didn't disambiguate with names, everything is
			// a leftover.
			var leftovers = new Array();
			for each (var key in this.ambigs[akey]){
				leftovers.push(this.registry[key]);
				leftovers.sort(this.compareRegistryTokens);
			}
		}
	}
	//
	// for anything left over, set disambiguate to true, and
	// try again from the base.
	if (leftovers && leftovers.length && state.opt.has_disambiguate){
		var leftovers = this.disambiguateCites(state,akey,modes,leftovers);
	}

	if ( leftovers && leftovers.length && state[state.tmp.area].opt["disambiguate-add-year-suffix"]){
		//var suffixes = state.fun.suffixator.get_suffixes(leftovers.length);
		for (var i in leftovers){
			this.registry[ leftovers[i].id ].disambig[2] = i;
			this.registry[ leftovers[i].id ].dseq = i;
		}
	}
	if (this.debug) {
		print("---> End of registry cleanup");
	}
};

/**
 * Compare two sort keys
 * <p>Nested, because keys are an array.</p>
 */
CSL.Factory.Registry.Comparifier = function(state,keyset){
	var sort_directions = state[keyset].opt.sort_directions.slice();
    this.compareKeys = function(a,b){
		for (var i=0; i < a.length; i++){
			//
			// for ascending sort 1 uses 1, -1 uses -1.
			// For descending sort, the values are reversed.
			//
			// XXXXX
			//
			// Need to handle undefined values.  No way around it.
			// So have to screen .localeCompare (which is also
			// needed) from undefined values.  Everywhere, in all
			// compares.
			//
			var cmp = 0;
			if ( !a[i].length || !b[i].length ){
				if (a[i] < b[i]){
					cmp = -1;
				} else if (a[i] > b[i]){
					cmp = 1;
				}
			} else {
				cmp = a[i].toLocaleLowerCase().localeCompare(b[i].toLocaleLowerCase());
			}
			if (0 < cmp){
				return sort_directions[i][1];
			} else if (0 > cmp){
				return sort_directions[i][0];
			}
		}
		return 0;
	};
};


/**
 * Compare two disambiguation tokens by their registry sort order
 * <p>Disambiguation lists need to be sorted this way, to
 * obtain the correct year-suffix when that's used.</p>
 */
CSL.Factory.Registry.prototype.compareRegistryTokens = function(a,b){
	if (a.seq > b.seq){
		return 1;
	} else if (a.seq < b.seq){
		return -1;
	}
	return 0;
};

CSL.Factory.Registry.prototype.incrementSubsequentTokens = function (tok){
	while (tok.next){
		tok.seq += 1;
		tok = this.registry[tok.next];
	}
	tok.seq += 1;
};
